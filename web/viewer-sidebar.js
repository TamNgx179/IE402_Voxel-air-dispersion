/* Sidebar navigation and height milestones; no simulation/data changes. */
(function(root) {
  'use strict';
  function milestones(heights) {
    if(!heights.length) return [];
    const last=heights.length-1;
    return [...new Set([0,.25,.5,.75,1].map(t=>Math.round(t*last)))].map(index=>({
      index,height:heights[index],position:last?index/last*100:0,
      label:`${Number(heights[index]).toLocaleString('vi-VN',{maximumFractionDigits:2})} m`,
    }));
  }
  function mount(doc,onOpen=()=>{}) {
    const buttons=Array.from(doc.querySelectorAll('[data-tool-panel]'));
    const disclosures=Array.from(doc.querySelectorAll('[data-disclosure]'));
    function open(id) {
      for(const button of buttons) {
        const selected=button.dataset.toolPanel===id;
        button.setAttribute('aria-expanded',String(selected));
        doc.getElementById(button.dataset.toolPanel).hidden=!selected;
      }
      onOpen(id);
    }
    for(const button of buttons) button.addEventListener('click',()=>{
      open(button.getAttribute('aria-expanded')==='true'?null:button.dataset.toolPanel);
    });
    for(const button of disclosures) button.addEventListener('click',()=>{
      const target=doc.getElementById(button.dataset.disclosure);
      target.hidden=!target.hidden;
      button.setAttribute('aria-expanded',String(!target.hidden));
    });
    open(null);
    return {open};
  }
  function heightMarks(doc,slider,heights,onSelect) {
    const marks=doc.getElementById('height-marks');
    const dots=doc.getElementById('height-dots');
    marks.replaceChildren();dots.replaceChildren();
    const buttons=[],points=[];
    for(const item of milestones(heights)) {
      const button=doc.createElement('button');
      button.type='button';button.className='height-mark';button.textContent=item.label;
      button.style.left=`${item.position}%`;
      button.setAttribute('aria-label',`Đến độ cao ${item.label}`);
      button.dataset.index=String(item.index);
      button.addEventListener('click',()=>{if(slider.disabled) return;slider.value=String(item.index);sync();onSelect(item.index);});
      const dot=doc.createElement('span');dot.className='height-dot';dot.style.left=`${item.position}%`;
      marks.appendChild(button);dots.appendChild(dot);buttons.push(button);points.push(dot);
    }
    function sync() {
      const index=Number(slider.value);
      slider.style.setProperty('--height-progress',`${heights.length>1?index/(heights.length-1)*100:0}%`);
      buttons.forEach((button,n)=>{
        const selected=Number(button.dataset.index)===index;
        button.disabled=slider.disabled;
        button.setAttribute('aria-pressed',String(selected));
        points[n].classList.toggle('is-current',selected);
      });
    }
    slider.addEventListener('input',sync);sync();
    return {sync};
  }
  const api={mount,heightMarks,milestones};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;else root.ViewerSidebar=api;
})(typeof window!=='undefined'?window:globalThis);
