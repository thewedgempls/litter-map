/* ══════════════════════════════════════════════════════════════════════
   the WEDGE Litter Tracker  v5
   ══════════════════════════════════════════════════════════════════════ */

// ── CONFIG ────────────────────────────────────────────────────────────────
const CFG = {
  center:   [44.954472, -93.292365],
  zoom:     17,
  maxAgeMs: 14 * 86400 * 1000,
  proximity: 5,
  tickMs:   60_000,
};

// ── DATA LAYER ────────────────────────────────────────────────────────────
// Report schema: { id:string, lat:number, lng:number, ts:number (epoch ms) }
//
// TO MIGRATE TO FIRESTORE:
//   db.getAll()          → getDocs(collection(fs,'reports'))
//   db.add(r)            → addDoc(collection(fs,'reports'), r)
//   db.update(id, patch) → updateDoc(doc(fs,'reports',id), patch)
//   db.remove(id)        → deleteDoc(doc(fs,'reports',id))
//   db.removeMany(ids)   → writeBatch delete
//   Live updates         → onSnapshot(collection(fs,'reports'), cb)
//
const db = (() => {
  const KEY='litter_v1';
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]');}catch{return[];}};
  const save=d=>localStorage.setItem(KEY,JSON.stringify(d));
  return{
    getAll:()=>load(),
    add:r=>{const d=load();d.push(r);save(d);},
    update:(id,p)=>{const d=load(),i=d.findIndex(r=>r.id===id);if(i>=0){Object.assign(d[i],p);save(d);return d[i];}return null;},
    remove:id=>save(load().filter(r=>r.id!==id)),
    removeMany:ids=>{const s=new Set(ids);save(load().filter(r=>!s.has(r.id)));},
  };
})();

// ── GEO UTILITIES ─────────────────────────────────────────────────────────
function haversine(la1,ln1,la2,ln2){
  const R=6371000,r=Math.PI/180,φ1=la1*r,φ2=la2*r,dφ=(la2-la1)*r,dλ=(ln2-ln1)*r;
  const a=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function inPoly(pt,poly){
  let inside=false,n=poly.length;
  for(let i=0,j=n-1;i<n;j=i++){
    const a=poly[i],b=poly[j];
    if((a.lat>pt.lat)!==(b.lat>pt.lat)&&pt.lng<(b.lng-a.lng)*(pt.lat-a.lat)/(b.lat-a.lat)+a.lng)
      inside=!inside;
  }
  return inside;
}
function distToSeg(pt,a,b){
  const mLat=111320,mLng=mLat*Math.cos(pt.lat*Math.PI/180);
  const px=(pt.lng-a.lng)*mLng,py=(pt.lat-a.lat)*mLat,bx=(b.lng-a.lng)*mLng,by=(b.lat-a.lat)*mLat;
  const len2=bx*bx+by*by;
  if(len2===0)return Math.hypot(px,py);
  const t=Math.max(0,Math.min(1,(px*bx+py*by)/len2));
  return Math.hypot(px-t*bx,py-t*by);
}
function m2px(metres,lat,zoom){
  return metres/(40075016.686*Math.cos(lat*Math.PI/180)/(256*2**zoom));
}

// ── COLOUR & TIME ─────────────────────────────────────────────────────────
function ageColor(ms){
  const g=Math.round(Math.min(ms/CFG.maxAgeMs,1)*255).toString(16).padStart(2,'0');
  return `#ff${g}00`;
}
function ageLabel(ms){
  const m=Math.floor(ms/60000);
  if(m<1)return 'Reported just now';
  if(m<60)return `Reported ${m} min${m!==1?'s':''} ago`;
  const h=Math.floor(ms/3600000);
  if(h<24)return `Reported ${h} hr${h!==1?'s':''} ago`;
  const d=Math.floor(ms/86400000);
  return `Reported ${d} day${d!==1?'s':''} ago`;
}
const uid=()=>crypto.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ── APP STATE ─────────────────────────────────────────────────────────────
let map,rl,pl,dl;
let mode='report';
let markers={};
let drawPts=[], history=[];
let affectedIds=new Set(), pulseMarkers={};
let draggingIdx=null, wasDragging=false;
// Dialog state
let dialogState=null, dialogReportId=null, pendingLatLng=null;
let currentPopup=null, pendingMarker=null;
let suppressDismiss=false;

// ── MAP INIT ──────────────────────────────────────────────────────────────
function initMap(){
  map=L.map('map',{center:CFG.center,zoom:CFG.zoom,maxZoom:22});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains:'abcd',
    maxZoom:22, maxNativeZoom:19,
  }).addTo(map);
  rl=L.layerGroup().addTo(map);
  pl=L.layerGroup().addTo(map);
  dl=L.layerGroup().addTo(map);
  map.on('click',onMapClick);
  map.on('zoomend',()=>{if(mode==='route'&&drawPts.length>=2)redrawPreview();});
  initDragListeners();
  loadReports();
  setMode('report');
  setInterval(tickColors,CFG.tickMs);
}

// ── DRAG SYSTEM ───────────────────────────────────────────────────────────
function containerPt(e,touch=false){
  const r=map.getContainer().getBoundingClientRect(),s=touch?(e.touches[0]||e.changedTouches[0]):e;
  return L.point(s.clientX-r.left,s.clientY-r.top);
}
function nearestDot(cPt,hitPx){
  for(let i=0;i<drawPts.length;i++)
    if(cPt.distanceTo(map.latLngToContainerPoint([drawPts[i].lat,drawPts[i].lng]))<=hitPx)return i;
  return -1;
}
function startDrag(idx){
  history.push({type:'drag',idx,from:{...drawPts[idx]}});
  draggingIdx=idx; wasDragging=true; map.dragging.disable();
  window.addEventListener('mousemove',wMM);
  window.addEventListener('mouseup',wMU);
  window.addEventListener('touchmove',wTM,{passive:false});
  window.addEventListener('touchend',wTE);
  updateHint();
}
function endDrag(){
  if(draggingIdx===null)return;
  draggingIdx=null; map.dragging.enable();
  window.removeEventListener('mousemove',wMM);
  window.removeEventListener('mouseup',wMU);
  window.removeEventListener('touchmove',wTM);
  window.removeEventListener('touchend',wTE);
  setTimeout(()=>{wasDragging=false;},200);
  updateHint();
}
function applyDrag(cPt){
  const ll=map.containerPointToLatLng(cPt);
  drawPts[draggingIdx]={lat:ll.lat,lng:ll.lng};
  redrawPreview();
}
function wMM(e){if(draggingIdx!==null)applyDrag(containerPt(e));}
function wMU(){endDrag();}
function wTM(e){if(draggingIdx!==null){e.preventDefault();applyDrag(containerPt(e,true));}}
function wTE(){endDrag();}
function initDragListeners(){
  const c=map.getContainer();
  c.addEventListener('mousedown',e=>{
    if(mode!=='area'&&mode!=='route')return;
    const idx=nearestDot(containerPt(e),14);
    if(idx>=0)startDrag(idx);
  });
  c.addEventListener('touchstart',e=>{
    if(mode!=='area'&&mode!=='route')return;
    const idx=nearestDot(containerPt(e,true),26);
    if(idx<0)return;
    e.preventDefault(); startDrag(idx);
  },{passive:false});
}

// ── REPORT MARKERS ────────────────────────────────────────────────────────
function loadReports(){
  const now=Date.now(),stale=[];
  db.getAll().forEach(r=>{if(now-r.ts>=CFG.maxAgeMs)stale.push(r.id);else addMarker(r);});
  if(stale.length)db.removeMany(stale);
}
function addMarker(r){
  const m=L.circleMarker([r.lat,r.lng],mkStyle(ageColor(Date.now()-r.ts)));
  m.on('click',e=>{
    L.DomEvent.stopPropagation(e);
    if(mode!=='report')return;
    if(dialogState===null){
      openReportActionDialog(r.id);
    } else if(dialogState==='report-action'){
      dialogReportId===r.id ? closeDialog() : openReportActionDialog(r.id);
    } else {
      closeDialog();
    }
  });
  m.addTo(rl); markers[r.id]=m;
}
function removeMarker(id){
  if(markers[id]){rl.removeLayer(markers[id]);delete markers[id];}
  if(pulseMarkers[id]){pl.removeLayer(pulseMarkers[id]);delete pulseMarkers[id];affectedIds.delete(id);}
}
function mkStyle(c){return{radius:9,fillColor:c,color:'#fff',weight:2,opacity:1,fillOpacity:.88};}
function tickColors(){
  const now=Date.now(),stale=[];
  db.getAll().forEach(r=>{
    const age=now-r.ts;
    if(age>=CFG.maxAgeMs)stale.push(r.id);
    else if(markers[r.id])markers[r.id].setStyle({fillColor:ageColor(age)});
  });
  if(stale.length){stale.forEach(removeMarker);db.removeMany(stale);}
}

// ── MAP CLICK ─────────────────────────────────────────────────────────────
function onMapClick(e){
  if(wasDragging||suppressDismiss)return;
  if(mode==='area'||mode==='route'){
    const cPx=map.latLngToContainerPoint(e.latlng);
    if(drawPts.some(p=>cPx.distanceTo(map.latLngToContainerPoint([p.lat,p.lng]))<14))return;
    addDrawPt(e.latlng.lat,e.latlng.lng); return;
  }
  if(dialogState!==null){closeDialog();return;}
  handleReportTap(e.latlng.lat,e.latlng.lng);
}

// ── MAP-POPUP DIALOG SYSTEM ───────────────────────────────────────────────
const POPUP_BASE={
  closeButton:false,closeOnClick:false,autoClose:false,
  className:'map-popup',maxWidth:260,minWidth:190,autoPanPadding:[24,52],
};
function showPopup(latlng,html,offsetY=-12){
  if(currentPopup)map.closePopup(currentPopup);
  currentPopup=L.popup({...POPUP_BASE,offset:[0,offsetY]})
    .setLatLng(latlng).setContent(html).openOn(map);
}
function updatePopup(html){
  if(!currentPopup)return;
  // Disable autopan during content swap so the popup doesn't drift
  // under a still-active touch, which would cause the follow-on tap
  // to land on the map and immediately dismiss the new dialog.
  const ap=currentPopup.options.autoPan;
  currentPopup.options.autoPan=false;
  currentPopup.setContent(html);
  currentPopup.options.autoPan=ap;
}
function closeDialog(){
  if(currentPopup){map.closePopup(currentPopup);currentPopup=null;}
  if(pendingMarker){map.removeLayer(pendingMarker);pendingMarker=null;}
  dialogState=null;dialogReportId=null;pendingLatLng=null;
}

// ── New-report flow ───────────────────────────────────────────────────────
function handleReportTap(lat,lng){
  const near=db.getAll().find(r=>haversine(lat,lng,r.lat,r.lng)<=CFG.proximity);
  near ? openResetNearbyDialog(near) : openNewReportDialog(lat,lng);
}
function openNewReportDialog(lat,lng){
  closeDialog();
  dialogState='new-report'; pendingLatLng={lat,lng};
  pendingMarker=L.marker([lat,lng],{
    icon:L.divIcon({html:'<div class="pending-icon">🗑️</div>',className:'',iconSize:[32,32],iconAnchor:[16,16]}),
    interactive:false,zIndexOffset:200,
  }).addTo(map);
  showPopup([lat,lng],`
    <div class="pop-inner">
      <div class="pop-title">Report litter here?</div>
      <div class="pop-row">
        <button class="btn btn-muted btn-sm" onclick="closeDialog()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="confirmNewReport()">Add Report</button>
      </div>
    </div>
  `,-22);
}
function confirmNewReport(){
  const{lat,lng}=pendingLatLng; closeDialog();
  const r={id:uid(),lat,lng,ts:Date.now()};
  db.add(r); addMarker(r);
}
function openResetNearbyDialog(report){
  closeDialog();
  dialogState='reset-nearby'; dialogReportId=report.id;
  showPopup([report.lat,report.lng],`
    <div class="pop-inner">
      <div class="pop-title">Reset Report?</div>
      <div class="pop-body">A report already exists within 5 m. Reset its age to confirm it's still here?</div>
      <div class="pop-row">
        <button class="btn btn-muted btn-sm" onclick="closeDialog()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="confirmReset()">Reset Age</button>
      </div>
    </div>
  `);
}
function confirmReset(){
  const id=dialogReportId; closeDialog();
  db.update(id,{ts:Date.now()});
  if(markers[id])markers[id].setStyle({fillColor:ageColor(0)});
}

// ── Existing-report flow (action → confirmation) ──────────────────────────
function openReportActionDialog(id){
  closeDialog();
  const r=db.getAll().find(x=>x.id===id);
  if(!r)return;
  dialogState='report-action'; dialogReportId=id;
  showPopup([r.lat,r.lng],`
    <div class="pop-inner">
      <div class="pop-age">${ageLabel(Date.now()-r.ts)}</div>
      <div class="pop-row">
        <button class="btn btn-primary btn-sm" onclick="askStillHere()">🔄 Still Here</button>
        <button class="btn btn-green  btn-sm"  onclick="askMarkCleaned()">✓ Mark Cleaned</button>
      </div>
    </div>
  `);
}
function askStillHere(){
  suppressDismiss=true; setTimeout(()=>{suppressDismiss=false;},150);
  dialogState='confirm-still-here';
  updatePopup(`
    <div class="pop-inner">
      <div class="pop-title">Confirm: Still Here?</div>
      <div class="pop-body">Resets this report's age to today, keeping it on the map for another 14 days.</div>
      <div class="pop-row">
        <button class="btn btn-muted   btn-sm" onclick="closeDialog()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="confirmStillHere()">Confirm</button>
      </div>
    </div>
  `);
}
function askMarkCleaned(){
  suppressDismiss=true; setTimeout(()=>{suppressDismiss=false;},150);
  dialogState='confirm-cleaned';
  updatePopup(`
    <div class="pop-inner">
      <div class="pop-title">Confirm: Mark Cleaned?</div>
      <div class="pop-body">Permanently removes this report from the map. Use once the litter has been cleaned up.</div>
      <div class="pop-row">
        <button class="btn btn-muted btn-sm"  onclick="closeDialog()">Cancel</button>
        <button class="btn btn-green btn-sm"  onclick="confirmMarkCleaned()">Mark Cleaned</button>
      </div>
    </div>
  `);
}
function confirmStillHere(){
  const id=dialogReportId; closeDialog();
  db.update(id,{ts:Date.now()});
  if(markers[id])markers[id].setStyle({fillColor:ageColor(0)});
}
function confirmMarkCleaned(){
  const id=dialogReportId; closeDialog();
  db.remove(id); removeMarker(id);
}

// ── DRAW POINTS ───────────────────────────────────────────────────────────
function addDrawPt(lat,lng){history.push({type:'add'});drawPts.push({lat,lng});redrawPreview();updateHint();}
function undoPoint(){
  if(!history.length)return;
  const last=history.pop();
  if(last.type==='add')drawPts.pop();
  else if(last.type==='drag')drawPts[last.idx]=last.from;
  redrawPreview(); updateHint();
}

// ── DRAW PREVIEW ──────────────────────────────────────────────────────────
function redrawPreview(){
  dl.clearLayers();
  if(!drawPts.length){updateAffected();return;}
  const color=mode==='area'?'#d97706':'#7c3aed';
  const lls=drawPts.map(p=>[p.lat,p.lng]);
  if(mode==='route'&&drawPts.length>=2){
    const midLat=drawPts.reduce((s,p)=>s+p.lat,0)/drawPts.length;
    const bufPx=m2px(CFG.proximity*2,midLat,map.getZoom());
    L.polyline(lls,{color,weight:Math.max(bufPx,6),opacity:.2,lineCap:'round',lineJoin:'round'}).addTo(dl);
  }
  if(drawPts.length>=2){
    if(mode==='route')
      L.polyline(lls,{color,weight:2.5,opacity:.9,dashArray:'6 4'}).addTo(dl);
    else if(drawPts.length>=3)
      L.polygon(lls,{color,weight:2,fillColor:color,fillOpacity:.15}).addTo(dl);
    else
      L.polyline(lls,{color,weight:2,opacity:.7,dashArray:'4 4'}).addTo(dl);
  }
  drawPts.forEach(p=>
    L.circleMarker([p.lat,p.lng],{radius:6,fillColor:color,color:'#fff',weight:2.5,fillOpacity:1,className:'draw-dot'}).addTo(dl)
  );
  updateAffected();
}

// ── PULSE LAYER (diff-based) ───────────────────────────────────────────────
function getAffectedIds(){
  if(!drawPts.length)return new Set();
  const rows=db.getAll();
  let hit=[];
  if(mode==='area'&&drawPts.length>=3)
    hit=rows.filter(r=>inPoly({lat:r.lat,lng:r.lng},drawPts));
  else if(mode==='route'&&drawPts.length>=2)
    hit=rows.filter(r=>{
      for(let i=0;i<drawPts.length-1;i++)
        if(distToSeg({lat:r.lat,lng:r.lng},drawPts[i],drawPts[i+1])<=CFG.proximity)return true;
      return false;
    });
  return new Set(hit.map(r=>r.id));
}
function updateAffected(){
  if(mode!=='area'&&mode!=='route'){pl.clearLayers();pulseMarkers={};affectedIds.clear();return;}
  const newAff=getAffectedIds();
  for(const id of[...affectedIds]){
    if(!newAff.has(id)){if(pulseMarkers[id]){pl.removeLayer(pulseMarkers[id]);delete pulseMarkers[id];}affectedIds.delete(id);}
  }
  for(const id of newAff){
    if(!affectedIds.has(id)){
      const r=db.getAll().find(x=>x.id===id);
      if(!r)continue;
      pulseMarkers[id]=L.circleMarker([r.lat,r.lng],{
        radius:9,fillColor:'transparent',color:'#4fbfbc',weight:2.5,opacity:1,fillOpacity:0,className:'pulse-ring',
      }).addTo(pl);
      affectedIds.add(id);
    }
  }
}

// ── CLEANUP HINT ──────────────────────────────────────────────────────────
function updateHint(){
  const n=drawPts.length,min=mode==='area'?3:2,noun=mode==='area'?'point':'waypoint';
  document.getElementById('cleanup-hint').textContent=
    `${n} ${noun}${n!==1?'s':''}${n<min?` — need at least ${min}`:''}`;
  document.getElementById('btn-submit').disabled=(n<min);
  document.getElementById('btn-undo').disabled=(!history.length||draggingIdx!==null);
}

// ── SUBMIT CLEANUP ────────────────────────────────────────────────────────
async function submitCleanup(){
  const rows=db.getAll();
  let clean=[];
  if(mode==='area')clean=rows.filter(r=>inPoly({lat:r.lat,lng:r.lng},drawPts));
  else clean=rows.filter(r=>{
    for(let i=0;i<drawPts.length-1;i++)
      if(distToSeg({lat:r.lat,lng:r.lng},drawPts[i],drawPts[i+1])<=CFG.proximity)return true;
    return false;
  });
  const n=clean.length;
  const body=n===0
    ?`No active reports in that ${mode==='area'?'area':'route corridor'}. Submit anyway?`
    :`Mark ${n} report${n!==1?'s':''} as cleaned?`;
  if(!await ask('Submit Cleanup?',body))return;
  const ids=clean.map(r=>r.id);
  db.removeMany(ids); ids.forEach(removeMarker); exitCleanup();
}
function exitCleanup(){setMode('report');}

// ── MODE SWITCHING ────────────────────────────────────────────────────────
const MODES={
  report:{label:'Report',       color:'#4fbfbc',glow:'rgba(79,191,188,.28)', hint:'Tap the map to add a litter report'},
  area:  {label:'Area Cleanup', color:'#d97706',glow:'rgba(217,119,6,.28)',  hint:'Tap to draw a polygon — drag points to adjust'},
  route: {label:'Route Cleanup',color:'#7c3aed',glow:'rgba(124,58,237,.28)', hint:'Tap to add waypoints — drag points to adjust'},
};
function setMode(m){
  closeDialog();
  if(m!==mode){
    drawPts=[];history=[];
    dl.clearLayers();
    pl.clearLayers();pulseMarkers={};affectedIds.clear();
  }
  mode=m;
  const isCleanup=m==='area'||m==='route';
  ['report','area','route'].forEach(k=>document.getElementById(`btn-${k}`)?.classList.toggle('active',k===m));
  document.getElementById('tb-normal').classList.toggle('hidden',isCleanup);
  document.getElementById('tb-cleanup').classList.toggle('hidden',!isCleanup);
  document.getElementById('map').classList.toggle('crosshair',isCleanup);
  const cfg=MODES[m];
  document.getElementById('badge').textContent=cfg.label;
  document.getElementById('status-text').textContent=cfg.hint;
  // Drive the full palette from a single CSS variable pair
  document.documentElement.style.setProperty('--mode-color',cfg.color);
  document.documentElement.style.setProperty('--mode-glow',cfg.glow);
  if(isCleanup)updateHint();
}

// ── MODAL (cleanup submit only) ───────────────────────────────────────────
let _res=null;
function ask(title,body){
  return new Promise(resolve=>{
    _res=resolve;
    document.getElementById('modal-title').textContent=title;
    document.getElementById('modal-body').textContent=body;
    document.getElementById('modal-overlay').classList.remove('hidden');
  });
}
function resolveModal(val){
  document.getElementById('modal-overlay').classList.add('hidden');
  if(_res){_res(val);_res=null;}
}

// ── BOOT ──────────────────────────────────────────────────────────────────
initMap();
