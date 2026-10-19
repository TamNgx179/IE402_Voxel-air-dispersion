/* Exact analysis state and UI. No scientific values are decoded from display codes. */
(function(root) {
  'use strict';
  function latestTask() {
    let revision=0;
    return { invalidate:()=>++revision, async run(work,commit,fail) {
      const token=++revision;
      try { const data=await work(); if(token===revision) commit(data); }
      catch(error) { if(token===revision) fail(error); }
    } };
  }
  function color(value,lo,hi,delta=false) {
    if (!Number.isFinite(value)) return [0,0,0,0];
    let a,b,t;
    if(delta) {
      const limit=Math.max(Math.abs(lo),Math.abs(hi),1e-12);
      t=Math.min(1,Math.abs(value)/limit); a=[245,242,232]; b=value<0?[75,111,140]:[157,83,78];
    } else {
      t=Math.max(0,Math.min(1,(value-lo)/(hi-lo||1))); a=[248,238,211]; b=[112,53,65];
    }
    return [...a.map((v,i)=>Math.round(v+(b[i]-v)*t)),205];
  }
  function closePolygon(points) {
    if(!Array.isArray(points) || points.length<3) throw new Error('Cần ít nhất 3 đỉnh.');
    if(points.length>499 || points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)))) throw new Error('Tọa độ không hợp lệ hoặc quá nhiều đỉnh.');
    const ring=points.map(p=>[...p]);
    if(ring[0][0]!==ring.at(-1)[0] || ring[0][1]!==ring.at(-1)[1]) ring.push([...ring[0]]);
    return polygonShape({type:'Polygon',coordinates:[ring]});
  }
  function polygonShape(raw) {
    if(!raw || raw.type!=='Polygon' || Object.keys(raw).some(k=>!['type','coordinates'].includes(k)) || !Array.isArray(raw.coordinates) || !raw.coordinates.length || raw.coordinates.length>20) throw new Error('Cần GeoJSON Polygon với 1–20 vòng.');
    let count=0;
    for(const ring of raw.coordinates) {
      if(!Array.isArray(ring)||ring.length<4) throw new Error('Mỗi vòng cần ít nhất 4 tọa độ, gồm điểm đóng.');
      count+=ring.length;if(count>500) throw new Error('Tối đa 500 tọa độ.');
      if(ring.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v))||Math.abs(p[0])>180||Math.abs(p[1])>90)) throw new Error('Dùng cặp kinh độ/vĩ độ hữu hạn, không có tọa độ z.');
      if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1]) throw new Error('Vòng polygon phải đóng.');
    }
    return {type:'Polygon',coordinates:raw.coordinates.map(r=>r.map(p=>[...p]))};
  }
  const number = value=>value===null||value===undefined ? 'Không có dữ liệu' : Number(value).toLocaleString('vi-VN',{maximumSignificantDigits:5});
  function analysisError(error) {
    const message=String(error?.message||'');
    if(/positive area|self.?intersection|polygon must be valid/i.test(message)) return 'Vùng đã vẽ không hợp lệ. Hãy vẽ lại, tránh để các cạnh cắt nhau hoặc các điểm nằm trên cùng một đường thẳng.';
    if(/fully inside|outside.*study area|not covered/i.test(message)) return 'Vùng đã chọn nằm ngoài khu vực mô phỏng. Hãy vẽ lại hoàn toàn bên trong khu vực có dữ liệu.';
    if(/z_m outside|z_min_m|z_max_m|domain height/i.test(message)) return 'Khoảng độ cao không hợp lệ. Chọn độ cao nằm trong mô hình và để độ cao bắt đầu nhỏ hơn độ cao kết thúc.';
    if(/share study area|different solid masks|incomplete grids/i.test(message)) return 'Hai kết quả không cùng lưới hoặc mô hình tòa nhà nên không thể so sánh. Hãy chọn kết quả khác.';
    if(/requires succeeded/i.test(message)) return 'Mô phỏng chưa hoàn tất. Chọn một kết quả đã chạy thành công.';
    if(error?.kind==='not-found'||error?.status===404) return 'Không tìm thấy kết quả mô phỏng. Hãy chọn lại kết quả.';
    if(error?.kind==='permission'||[401,403].includes(error?.status)) return 'Bạn chưa có quyền truy cập kết quả này.';
    if(error?.kind==='timeout') return 'Yêu cầu mất quá nhiều thời gian. Hãy thử lại.';
    if(error?.kind==='network'||/offline|failed to fetch|network error|ECONN/i.test(message)) return 'Mất kết nối với ứng dụng. Kiểm tra kết nối rồi thử lại.';
    if(error?.status>=500) return 'Hệ thống chưa xử lý được yêu cầu. Vui lòng thử lại sau.';
    // Client validation is already written in Vietnamese. Never echo unknown server text.
    if(!error?.status&&/[À-ỹ]/.test(message)) return message;
    if(error?.kind==='conflict'||error?.status===409) return 'Kết quả hiện tại chưa phù hợp để phân tích. Hãy chọn một kết quả đã hoàn tất và thử lại.';
    if(error?.kind==='validation'||error?.status===400) return 'Thông tin phân tích chưa hợp lệ. Kiểm tra lại vùng, độ cao và ngưỡng tham chiếu.';
    return 'Chưa thực hiện được thao tác. Vui lòng thử lại.';
  }

  function metrics(doc, entries) {
    const list=doc.createElement('dl');list.className='result-metrics';
    for(const [label,value,unit] of entries) {
      const item=doc.createElement('div'),name=doc.createElement('dt'),reading=doc.createElement('dd');
      name.textContent=label;reading.textContent=number(value);
      if(value!==null && value!==undefined && unit) {const suffix=doc.createElement('small');suffix.textContent=unit;reading.append(suffix);}
      item.append(name,reading);list.append(item);
    }
    return list;
  }
  function regionSummary(doc,box,result,runLabel) {
    box.replaceChildren();
    const text=(value,className='note')=>{const p=doc.createElement('p');p.className=className;p.textContent=value;box.append(p);};
    text(`${runLabel} · ${number(result.z_min_m)}–${number(result.z_max_m)} m`,'result-context');
    if(!(result.air_volume_m3>0)) {
      text('Không có dữ liệu không khí trong vùng và khoảng độ cao này. Thử vùng khác hoặc mở rộng khoảng độ cao.','result-insight');
      text('Không có dữ liệu không đồng nghĩa với nồng độ bằng 0.');return;
    }
    const percent=result.exceedance_volume_m3/result.air_volume_m3*100;
    box.append(metrics(doc,[['Nồng độ trung bình',result.mean_ug_m3,'µg/m³'],['Nồng độ cao nhất',result.max_ug_m3,'µg/m³'],['Thể tích vượt ngưỡng',percent,'%'],['Thể tích khí được tính',result.air_volume_m3,'m³']]));
    text(result.exceedance_volume_m3>0
      ? `${number(percent)}% thể tích khí vượt ${number(result.threshold_ug_m3)} µg/m³ (${number(result.exceedance_volume_m3)} m³).`
      : `Không ghi nhận thể tích khí vượt ${number(result.threshold_ug_m3)} µg/m³ trong kết quả mô hình này.`,'result-insight');
    if(Number.isFinite(result.area_m2)) text(`Diện tích vùng: ${number(result.area_m2)} m². Trung bình có trọng số theo thể tích khí; bỏ ô rắn và ô thiếu dữ liệu.`);
    if(result.layers?.length) {
      const title=doc.createElement('h4');title.textContent='Nồng độ theo độ cao';box.append(title);
      const scroll=doc.createElement('div');scroll.className='result-table-scroll';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Bảng nồng độ theo độ cao, cuộn để xem các tầng');
      const table=doc.createElement('table');table.className='result-table';
      const caption=doc.createElement('caption');caption.textContent='Tâm tầng và nồng độ (µg/m³) trong phần tầng giao với khoảng đã chọn';table.append(caption);
      const head=doc.createElement('thead'),header=doc.createElement('tr');
      for(const label of ['Tâm tầng (m)','Trung bình','Cao nhất']) {const th=doc.createElement('th');th.scope='col';th.textContent=label;header.append(th);}head.append(header);table.append(head);
      const body=doc.createElement('tbody');
      for(const layer of result.layers) {
        const row=doc.createElement('tr');
        for(const value of [layer.z_center_m,layer.mean_ug_m3,layer.max_ug_m3]) {const td=doc.createElement('td');td.textContent=number(value);row.append(td);}body.append(row);
      }
      table.append(body);scroll.append(table);box.append(scroll);
    }
    text('Tham chiếu kết quả mô hình, không kết luận chất lượng không khí quan trắc 24 giờ.');
  }

  function mount({document:doc,map,deck,api,context,redraw}) {
    const $=id=>doc.getElementById(id);
    const compareTask=latestTask(), regionTask=latestTask();
    let payload=null, polygon=null, points=[],drawing=false,key='',runId=null,regionResult=null, timer;
    let selectionBackup=null, modified=false,regionBusy=false,exportBusy=false;
    const active=()=>$('analysis-view').value!=='off';
    const view=()=>$('analysis-view').value;
    const status=(id,text)=>{ $(id).textContent=text; };
    function regionControls() {
      const ctx=context();
      $('region-draw').hidden=drawing;
      $('region-draw').textContent=polygon?'Vẽ lại vùng':'Vẽ vùng';
      $('region-draw').disabled=!ctx.id||regionBusy;
      $('region-clear').hidden=!polygon||drawing;
      $('region-clear').disabled=regionBusy;
      $('region-finish').hidden=!drawing;$('region-finish').disabled=points.length<3;
      $('region-cancel').hidden=!drawing;
      $('region-settings').hidden=!polygon||drawing;
      $('region-query').disabled=regionBusy||drawing||!polygon||ctx.modified||!ctx.id;
      $('region-query').textContent=regionBusy?'Đang phân tích…':regionResult?'Phân tích lại':'Phân tích vùng';
      $('region-result').hidden=!regionResult;
      $('region-export').hidden=!regionResult;
      $('region-export').disabled=!regionResult||exportBusy;
      $('region-export').textContent=exportBusy?'Đang tải CSV…':'Tải CSV';
    }
    function clearRegion() {
      regionTask.invalidate(); regionResult=null;regionBusy=false;exportBusy=false;
      $('region-feedback').setAttribute('aria-busy','false');
      status('region-feedback','');$('region-result-content').replaceChildren();regionControls();
    }
    function endDrawing() {
      drawing=false;
      if(selectionBackup) { if(selectionBackup.doubleClickZoom) map.doubleClickZoom.enable(); selectionBackup=null; }
      map.getCanvas().style.cursor='';
      regionControls();
    }
    function setPolygon(value) {
      polygon=value; points=[]; endDrawing(); clearRegion();
      status('region-note',`Đã chọn vùng · ${value.coordinates[0].length-1} đỉnh. Chọn độ cao bên dưới.`);
      redraw();
    }
    function cancelDrawing() {
      points=[]; endDrawing(); clearRegion(); status('region-note',polygon?'Giữ vùng đã chọn trước đó.':'');redraw();
    }
    function sync() {
      const ctx=context();
      if(modified!==ctx.modified) {modified=ctx.modified;clearRegion();}
      const select=$('compare-run');
      if(select.options.length!==ctx.runs.length+1) {
        const saved=select.value;
        const option=(label,value)=>{const el=doc.createElement('option');el.textContent=label;el.value=value;return el;};
        select.replaceChildren(); select.add(option('Chọn kết quả so sánh',''));
        for(const run of ctx.runs) select.add(option(run.label,run.id));
        select.value=saved;
      }
      $('analysis-baseline').textContent=ctx.id ? `Gốc: ${ctx.runs.find(r=>r.id===ctx.id)?.label||ctx.id}`:'Chưa có kết quả gốc.';
      $('comparison-retry').disabled=!active()||ctx.modified||!ctx.id||!select.value;
      regionControls();
      $('region-max').max=String(ctx.height);
      if(runId!==ctx.id) {
        runId=ctx.id; clearRegion(); status('region-note',polygon?'Vùng giữ nguyên; phân tích lại để xem kết quả mới.':'');
      }
      if(!ctx.id) status('region-note','Chọn một kết quả mô phỏng trước khi khoanh vùng.');
      if(ctx.modified) status('region-feedback','Đang dùng minh họa. Vào Minh họa → Về dữ liệu gốc để phân tích.');
      const next=JSON.stringify([ctx.id,select.value,ctx.z,active(),ctx.modified]);
      if(next!==key) {
        key=next; compareTask.invalidate(); payload=null; clearTimeout(timer);
        $('comparison-retry').hidden=true;
        $('comparison-note').setAttribute('aria-busy','false');
        $('comparison-result').replaceChildren();
        if(active()) {
          if(ctx.modified) status('comparison-note','Tắt hệ số/nền minh họa (×1, nền 0) để phân tích dữ liệu gốc.');
          else if(!ctx.id || !select.value) status('comparison-note','Chọn một kết quả so sánh.');
          else {
            status('comparison-note','Đang truy vấn dữ liệu chính xác…');
            $('comparison-note').setAttribute('aria-busy','true');
            timer=setTimeout(loadComparison,180);
          }
        } else status('comparison-note','Chọn lớp xem để bật so sánh.');
      }
      for(const id of ['legend','legend-title','legend-labels','legend-note']) $(id).hidden=active();
    }
    function comparisonSummary() {
      const box=$('comparison-result'); box.replaceChildren();
      if(!payload) return;
      const delta=view()==='delta';
      const values=payload.feature_collection.features.flatMap(f=>[f.properties.baseline_ug_m3,f.properties.comparison_ug_m3]);
      const lo=delta ? payload.stats.delta.min_ug_m3 : 0;
      const hi=delta ? payload.stats.delta.max_ug_m3 : Math.max(0,...values);
      const limit=Math.max(Math.abs(lo||0),Math.abs(hi||0));
      const legend=doc.createElement('div'); legend.className='analysis-ramp';
      legend.style.background=delta?'linear-gradient(90deg,#4b6f8c,#f5f2e8,#9d534e)':'linear-gradient(90deg,#f8eed3,#703541)';
      const caption=doc.createElement('p'); caption.className='note';
      caption.textContent=delta ? `ΔC: ${number(-limit)} → 0 → ${number(limit)} µg/m³ · so sánh − gốc` : `Nồng độ: 0 → ${number(hi)} µg/m³ · cùng thang tuyến tính cho hai run`;
      box.append(legend,caption);
      box.append(metrics(doc,[['Trung bình · gốc',payload.stats.baseline.mean_ug_m3,'µg/m³'],['Trung bình · so sánh',payload.stats.comparison.mean_ug_m3,'µg/m³'],['Chênh lệch trung bình',payload.stats.delta.mean_ug_m3,'µg/m³']]));
      const insight=doc.createElement('p');insight.className='result-insight';
      const difference=payload.stats.delta.mean_ug_m3;
      insight.textContent=difference===null?'Không có ô khí chung để so sánh.':difference===0?'Hai kết quả có cùng nồng độ trung bình ở tầng này.':`Kết quả so sánh ${difference>0?'cao':'thấp'} hơn gốc ${number(Math.abs(difference))} µg/m³ ở tầng này.`;
      box.append(insight);
      const chart=doc.createElement('div');chart.className='comparison-bars';chart.setAttribute('aria-hidden','true');
      const maxMean=Math.max(payload.stats.baseline.mean_ug_m3||0,payload.stats.comparison.mean_ug_m3||0,1e-12);
      for(const [label,stat] of [['Gốc',payload.stats.baseline],['So sánh',payload.stats.comparison]]) {
        const bar=doc.createElement('div');bar.className='comparison-bar';bar.style.width=`${(stat.mean_ug_m3||0)/maxMean*100}%`;bar.textContent=label;chart.append(bar);
      }
      box.append(chart);
    }
    async function loadComparison() {
      const ctx=context(), pair=$('compare-run').value;
      if(!active() || ctx.modified || !ctx.id || !pair) return;
      $('comparison-note').setAttribute('aria-busy','true');$('comparison-retry').disabled=true;
      await compareTask.run(()=>api(`/runs/${ctx.id}/comparison?compare_run_id=${encodeURIComponent(pair)}&z_m=${ctx.z}`),data=>{
        payload=data; $('comparison-note').setAttribute('aria-busy','false');$('comparison-retry').hidden=true;
        status('comparison-note',data.stats.air_cells ? `${data.stats.air_cells.toLocaleString('vi-VN')} ô khí · ${number(data.z_center_m)} m · gió/thống kê khác: run gốc`:'Tầng không có ô khí chung.');
        comparisonSummary();redraw();
      },error=>{ payload=null;$('comparison-note').setAttribute('aria-busy','false');$('comparison-retry').hidden=false;$('comparison-retry').disabled=false;status('comparison-note',analysisError(error));redraw(); });
    }
    function body() {
      if(!polygon) throw new Error('Chọn hoặc nhập vùng trước.');
      const ctx=context(); if(!ctx.id) throw new Error('Chưa có run gốc.');
      if(ctx.modified) throw new Error('Đưa hệ số về ×1 và nền 0 để truy vấn dữ liệu gốc.');
      const min=$('region-min').value,max=$('region-max').value,threshold=$('region-threshold').value;
      if(!min.trim()||!max.trim()||!Number.isFinite(Number(min))||!Number.isFinite(Number(max))||Number(min)<0||Number(min)>=Number(max)||Number(max)>ctx.height) throw new Error(`Nhập khoảng độ cao: 0 ≤ từ < đến ≤ ${number(ctx.height)} m.`);
      if(!threshold.trim()||!Number.isFinite(Number(threshold))||Number(threshold)<0) throw new Error('Ngưỡng tham chiếu phải là số không âm.');
      return {polygon,z_min_m:Number(min),z_max_m:Number(max),threshold_ug_m3:Number(threshold)};
    }
    async function queryRegion() {
      if(regionBusy) return;
      clearRegion();
      try {
        const request=body(),ctx=context();
        regionBusy=true;regionControls();
        $('region-feedback').setAttribute('aria-busy','true');status('region-feedback','Đang tính thống kê trong vùng…');
        await regionTask.run(()=>api(`/runs/${ctx.id}/region`,{method:'POST',body:JSON.stringify(request)}),result=>{
          regionResult={result,request,run:ctx.id};regionBusy=false;$('region-feedback').setAttribute('aria-busy','false');
          status('region-feedback','Đã phân tích xong. Kết quả ở bên dưới.');
          regionSummary(doc,$('region-result-content'),result,ctx.runs.find(r=>r.id===ctx.id)?.label||'Kết quả đang chọn');
          regionControls();
          if(!$('spatial-analysis').hidden&&!$('region-panel').hidden) $('region-result').scrollIntoView?.({block:'nearest',behavior:'auto'});
        },error=>{regionBusy=false;$('region-feedback').setAttribute('aria-busy','false');status('region-feedback',analysisError(error));regionControls();});
      } catch(error) {status('region-feedback',analysisError(error));regionControls();}
    }
    $('compare-run').addEventListener('change',()=>{if($('compare-run').value&&!active()) $('analysis-view').value='delta';key='';sync();redraw();});
    $('analysis-view').addEventListener('change',()=>{sync();comparisonSummary();redraw();});
    $('comparison-retry').addEventListener('click',()=>{compareTask.invalidate();payload=null;$('comparison-result').replaceChildren();loadComparison();redraw();});
    $('region-draw').addEventListener('click',()=>{
      if(drawing||regionBusy||!context().id) return;
      clearRegion();drawing=true;points=[];
      regionControls();
      selectionBackup={doubleClickZoom:map.doubleClickZoom.isEnabled()};map.doubleClickZoom.disable();
      map.getCanvas().style.cursor='crosshair';
      status('region-note','Bấm từng đỉnh trên bản đồ rồi Hoàn tất. Esc để hủy.');redraw();
    });
    map.on('click',event=>{if(drawing) {if(points.length>=499) {status('region-note','Tối đa 499 đỉnh.');return;}points.push([event.lngLat.lng,event.lngLat.lat]);status('region-note',points.length<3?`Đã chọn ${points.length}/3 điểm tối thiểu. Bấm tiếp trên bản đồ.`:`Đã chọn ${points.length} điểm. Bấm Hoàn tất để dùng vùng.`);regionControls();redraw();}});
    $('region-finish').addEventListener('click',()=>{try{setPolygon(closePolygon(points));}catch(e){status('region-note',analysisError(e));}});
    $('region-cancel').addEventListener('click',cancelDrawing);
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&drawing){cancelDrawing();$('region-draw').focus();}});
    $('region-clear').addEventListener('click',()=>{polygon=null;cancelDrawing();});
    for(const id of ['region-min','region-max','region-threshold']) $(id).addEventListener('input',()=>{clearRegion();status('region-note','Thông số đã đổi; nhấn Phân tích vùng để cập nhật.');});
    function analysisMode(compare) {
      if(compare&&drawing) cancelDrawing();
      if(!compare&&active()) {$('analysis-view').value='off';sync();redraw();}
      $('compare-panel').hidden=!compare;$('region-panel').hidden=compare;
      $('analysis-compare-mode').setAttribute('aria-pressed',String(compare));
      $('analysis-region-mode').setAttribute('aria-pressed',String(!compare));
    }
    $('analysis-region-mode').addEventListener('click',()=>analysisMode(false));
    $('analysis-compare-mode').addEventListener('click',()=>analysisMode(true));
    $('region-query').addEventListener('click',queryRegion);
    $('region-export').addEventListener('click',async()=>{
      if(!regionResult||exportBusy) return;
      const saved=regionResult;
      exportBusy=true;regionControls();
      try {
        const text=await api(`/runs/${saved.run}/region/csv`,{method:'POST',body:JSON.stringify(saved.request),responseType:'text'});
        if(saved!==regionResult) return;
        const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/csv;charset=utf-8'}));
        const link=doc.createElement('a');link.href=url;link.download=`region-${saved.run}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        status('region-feedback','Đã tải bảng CSV.');
      }catch(e){if(saved===regionResult) status('region-feedback',`Chưa tải được bảng số liệu. ${analysisError(e)}`);}
      finally {if(saved===regionResult) {exportBusy=false;regionControls();}}
    });
    function layers(z) {
      const result=[];
      if(active() && payload) {
        const values=payload.feature_collection.features.flatMap(f=>[f.properties.baseline_ug_m3,f.properties.comparison_ug_m3]);
        const hi=Math.max(0,...values),delta=view()==='delta';
        const field={baseline:'baseline_ug_m3',comparison:'comparison_ug_m3',delta:'delta_ug_m3'}[view()];
        const lifted={type:'FeatureCollection',features:payload.feature_collection.features.map(f=>({...f,geometry:{...f.geometry,coordinates:f.geometry.coordinates.map(ring=>ring.map(p=>[p[0],p[1],z]))}}))};
        result.push(new deck.GeoJsonLayer({id:'analysis-comparison',data:lifted,
          getPolygonOffset:()=>[0,-5],getElevation:z,parameters:{depthWriteEnabled:false},
          filled:true,stroked:false,pickable:!drawing,
          getFillColor:f=>color(f.properties[field],delta?payload.stats.delta.min_ug_m3:0,delta?payload.stats.delta.max_ug_m3:hi,delta),
          updateTriggers:{getFillColor:[payload,view()],getElevation:[z]},
          onClick:()=>{},
        }));
      }
      const rings=drawing?[points]:(polygon?.coordinates||[]);
      if(rings.some(r=>r.length>1)) result.push(new deck.PathLayer({id:'analysis-region-outline',data:rings.filter(r=>r.length>1),getPath:r=>r.map(p=>[...p,z+.2]),getColor:[66,106,133],getWidth:3,widthUnits:'pixels',pickable:false}));
      return result;
    }
    sync();
    return {sync,layers,active,view,cancelDrawing,isDrawing:()=>drawing,
      tooltip:feature=>{const p=feature.properties;return `Ô (${p.i}, ${p.j}) · dữ liệu gốc chính xác\nGốc ${number(p.baseline_ug_m3)} · so sánh ${number(p.comparison_ug_m3)}\nΔC ${number(p.delta_ug_m3)} µg/m³`;}};
  }
  const api={mount,latestTask,color,closePolygon,polygonShape,regionSummary,analysisError};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;else root.ViewerAnalysis=api;
})(typeof window!=='undefined'?window:globalThis);
