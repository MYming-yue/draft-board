import type { BoardNode, NodeShape, Op } from '../model';
import { CARD_CHROME_X, CARD_CHROME_Y } from './formulaLayout';

/** Measure the same rendered content before committing; never move a card in a later frame. */
function shapeSize(card: HTMLElement, shape: NodeShape): {w:number;h:number} {
  const width=Number(card.dataset.shapeBaseWidth);
  const source=card.querySelector(':scope > .node-shape-content') ?? card;
  const content=[...source.children].filter(el=>el.classList.contains('core-stage')||el.classList.contains('node-caption'));
  if(!(width>0)||!content.length||!card.parentElement)throw new Error('卡片尺寸尚未就绪，请稍后再切换外形。');
  const clone=card.cloneNode(false) as HTMLElement;
  clone.removeAttribute('data-node-id');
  clone.classList.remove('node-shape-card','node-shape-rectangle','node-shape-diamond','node-shape-pill');
  clone.classList.add(`node-shape-${shape}`);
  clone.style.cssText=`position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:${width}px;height:auto;`;
  const body=document.createElement('div');
  const shaped=shape==='diamond'||shape==='pill';
  if(shaped){body.className='node-shape-content';body.style.width=`${width-CARD_CHROME_X}px`;clone.append(body);}
  for(const el of content)(shaped?body:clone).append(el.cloneNode(true));
  card.parentElement.append(clone);
  try{
    if(shaped){
      const height=parseFloat(getComputedStyle(body).height)+CARD_CHROME_Y;
      clone.style.width=`${shape==='diamond'?width*2:width+height}px`;
      clone.style.height=`${height*(shape==='diamond'?2:1)}px`;
    }else if(card.dataset.shapeFixedHeight){clone.style.height=`${card.dataset.shapeFixedHeight}px`;}
    const style=getComputedStyle(clone),w=parseFloat(style.width),h=parseFloat(style.height);
    if(!(w>0&&h>0))throw new Error('卡片尺寸尚未就绪，请稍后再切换外形。');
    return {w,h};
  }finally{clone.remove();}
}

export function centeredShapeOps(nodes: BoardNode[], shape: NodeShape): Op[] {
  if(document.fonts.status==='loading')throw new Error('字体仍在加载，请稍后再切换外形。');
  const ops:Op[]=[];
  for(const n of nodes){
    if(n.type!=='text'||(n.shape??'card')===shape)continue;
    const card=[...document.querySelectorAll<HTMLElement>('.node-card[data-node-id]')].find(el=>el.dataset.nodeId===n.id);
    if(!card||card.classList.contains('editing'))throw new Error('请结束卡片编辑后再切换外形。');
    const current=getComputedStyle(card),next=shapeSize(card,shape);
    const x=n.x+(parseFloat(current.width)-next.w)/2,y=n.y+(parseFloat(current.height)-next.h)/2;
    ops.push({op:'setNodeShape',nodeId:n.id,before:null,after:{shape:shape==='card'?null:shape}});
    if(Math.abs(x-n.x)>1e-6||Math.abs(y-n.y)>1e-6)ops.push({op:'moveNode',nodeId:n.id,before:null,after:{x,y}});
  }
  return ops;
}
