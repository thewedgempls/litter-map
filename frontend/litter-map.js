/* ══════════════════════════════════════════════════════════════════════
   the WEDGE Litter Tracker
   ══════════════════════════════════════════════════════════════════════ */

// ── DEMO / FIREBASE TOGGLE ────────────────────────────────────────────────
// Set DEMO_MODE = false and fill FIREBASE_CONFIG to connect to Firestore.
// In demo mode the app works entirely from localStorage with no backend.
const DEMO_MODE = true;

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC5QZloHmVaB0wMSZyI8HZR5DaEuOFfWCs",
  authDomain: "litter-map-69921.firebaseapp.com",
  projectId: "litter-map-69921",
  storageBucket: "litter-map-69921.firebasestorage.app",
  messagingSenderId: "571285630878",
  appId: "1:571285630878:web:ca8b0ad556ca70a936b08f"
};

// ── CONFIG ────────────────────────────────────────────────────────────────
const CFG = {
  center:   [44.954472, -93.292365],
  zoom:     17,
  maxAgeMs: 14 * 86400 * 1000,
  proximity: 5 * 0.9144,   // 5 yards in metres
  tickMs:   60_000,
};

// ── DATA LAYER ────────────────────────────────────────────────────────────
// Report schema (in-memory): { id:string, latitude:number, longitude:number, timestamp:number (epoch ms), cleanedAt:number|null }
// In live mode, timestamp and cleanedAt are stored as Firestore Timestamps and normalized to epoch ms on read.
//
// In demo mode all persistence uses localStorage.
// In live mode (DEMO_MODE=false) all writes go to Firestore; getAll() returns
// an in-memory cache kept fresh by an onSnapshot listener (see handleFirestoreSnapshot).
// The doc id equals r.id, so markers/update/markCleaned all stay in sync.
//
// _fs is set during initMap() once Firebase is initialised (live mode only).
let _fs = null;

const db = (() => {
  if (DEMO_MODE) {
    const KEY='litter_v1';
    const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]');}catch{return[];}};
    const save=d=>localStorage.setItem(KEY,JSON.stringify(d));
    return{
      getAll:()=>load().filter(r=>!r.cleanedAt&&Date.now()-r.timestamp<CFG.maxAgeMs),
      add:r=>{const rec={...r,cleanedAt:null,id:uid()};const d=load();d.push(rec);save(d);return rec;},
      update:(id,p)=>{const d=load(),i=d.findIndex(r=>r.id===id);if(i>=0){Object.assign(d[i],p);save(d);return d[i];}return null;},
      markCleaned:id=>{const d=load(),i=d.findIndex(r=>r.id===id);if(i>=0){d[i].cleanedAt=Date.now();save(d);}},
      markCleanedMany:ids=>{const s=new Set(ids),d=load(),now=Date.now();d.forEach(r=>{if(s.has(r.id))r.cleanedAt=now;});save(d);},
    };
  }
  // Live Firestore implementation — timestamps are stored as Firestore Timestamp objects
  // and normalized to epoch ms by handleFirestoreSnapshot before entering _cache.
  let _cache=[];
  const col=()=>_fs.collection('reports');
  const ts=ms=>firebase.firestore.Timestamp.fromMillis(ms);
  return{
    _setCache:data=>{_cache=data;},
    getAll:()=>[..._cache],
    add:({id:_,...data})=>col().add({
      latitude:data.latitude,
      longitude:data.longitude,
      timestamp:ts(data.timestamp),
      cleanedAt:null,
    }),
    update:(id,p)=>{
      const patch={...p};
      if(typeof patch.timestamp==='number')patch.timestamp=ts(patch.timestamp);
      return col().doc(id).update(patch);
    },
    markCleaned:id=>col().doc(id).update({cleanedAt:firebase.firestore.Timestamp.now()}),
    markCleanedMany:ids=>{
      const b=_fs.batch(),now=firebase.firestore.Timestamp.now();
      ids.forEach(id=>b.update(col().doc(id),{cleanedAt:now}));
      return b.commit();
    },
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
let map,rl,pl,dl,locLayer;
let locActive=false,locLatLng=null,recenterPending=false;
let mode='report';
let markers={};
let drawPts=[], history=[];
let affectedIds=new Set(), pulseMarkers={};
let draggingIdx=null, wasDragging=false;
// Dialog state
let dialogState=null, dialogReportId=null, pendingLatLng=null;
let currentPopup=null, pendingMarker=null;
let suppressDismiss=false;

// ── FIRESTORE SYNC ────────────────────────────────────────────────────────
// Called on every Firestore snapshot. Diffs the incoming collection against
// the current marker layer so the map stays in sync with remote changes.
// Never touches pl (pulse rings) — only rl — to preserve pulse animation state.
function handleFirestoreSnapshot(snapshot){
  const now=Date.now(), live=new Map();
  snapshot.forEach(d=>{
    const raw=d.data();
    const r={
      id:d.id,
      latitude:raw.latitude,
      longitude:raw.longitude,
      timestamp:raw.timestamp?.toMillis?.()??raw.timestamp,
      cleanedAt:raw.cleanedAt?.toMillis?.()??raw.cleanedAt,
    };
    if(!r.cleanedAt&&now-r.timestamp<CFG.maxAgeMs)live.set(r.id,r);
  });
  // Remove markers for cleaned or newly-stale reports
  Object.keys(markers).forEach(id=>{if(!live.has(id))removeMarker(id);});
  // Add markers for new reports; refresh colours for updated ones
  live.forEach((r,id)=>{
    if(!markers[id])addMarker(r);
    else markers[id].setStyle({fillColor:ageColor(now-r.timestamp)});
  });
  db._setCache([...live.values()]);
}

// ── MAP INIT ──────────────────────────────────────────────────────────────
function initMap(){
  if(!DEMO_MODE){
    firebase.initializeApp(FIREBASE_CONFIG);
    _fs=firebase.firestore();
    firebase.auth().signInAnonymously().catch(()=>{});
    firebase.auth().onAuthStateChanged(user=>{
      if(user){
        const cutoff=firebase.firestore.Timestamp.fromMillis(Date.now()-CFG.maxAgeMs);
        _fs.collection('reports')
          .where('timestamp','>',cutoff)
          .where('cleanedAt','==',null)
          .onSnapshot(handleFirestoreSnapshot);
      }
    });
  }
  map=L.map('map',{center:CFG.center,zoom:CFG.zoom,maxZoom:22});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains:'abcd',
    maxZoom:22, maxNativeZoom:19,
  }).addTo(map);
  locLayer=L.layerGroup().addTo(map); // below report markers in SVG stacking order
  rl=L.layerGroup().addTo(map);
  pl=L.layerGroup().addTo(map);
  dl=L.layerGroup().addTo(map);
  map.on('click',onMapClick);
  map.on('zoomend',()=>{if(mode==='route'&&drawPts.length>=2)redrawPreview();});
  map.on('locationfound',onLocationFound);
  map.on('locationerror',onLocationError);
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
  db.getAll().forEach(r=>addMarker(r));
}
function addMarker(r){
  if(markers[r.id])return;
  const m=L.circleMarker([r.latitude,r.longitude],mkStyle(ageColor(Date.now()-r.timestamp)));
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
  const now=Date.now(),active=db.getAll(),activeIds=new Set(active.map(r=>r.id));
  Object.keys(markers).forEach(id=>{if(!activeIds.has(id))removeMarker(id);});
  active.forEach(r=>{if(markers[r.id])markers[r.id].setStyle({fillColor:ageColor(now-r.timestamp)});});
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
  const near=db.getAll().find(r=>haversine(lat,lng,r.latitude,r.longitude)<=CFG.proximity);
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
  if(DEMO_MODE)addMarker(db.add({latitude:lat,longitude:lng,timestamp:Date.now()}));
  else db.add({latitude:lat,longitude:lng,timestamp:Date.now()});
}
function openResetNearbyDialog(report){
  closeDialog();
  dialogState='reset-nearby'; dialogReportId=report.id;
  showPopup([report.latitude,report.longitude],`
    <div class="pop-inner">
      <div class="pop-title">Reset Report?</div>
      <div class="pop-body">A report already exists within 5 yd. Reset its age to confirm it's still here?</div>
      <div class="pop-row">
        <button class="btn btn-muted btn-sm" onclick="closeDialog()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="confirmReset()">Reset Age</button>
      </div>
    </div>
  `);
}
function confirmReset(){
  const id=dialogReportId; closeDialog();
  db.update(id,{timestamp:Date.now()});
  if(markers[id])markers[id].setStyle({fillColor:ageColor(0)});
}

// ── Existing-report flow (action → confirmation) ──────────────────────────
function openReportActionDialog(id){
  closeDialog();
  const r=db.getAll().find(x=>x.id===id);
  if(!r)return;
  dialogState='report-action'; dialogReportId=id;
  showPopup([r.latitude,r.longitude],`
    <div class="pop-inner">
      <div class="pop-age">${ageLabel(Date.now()-r.timestamp)}</div>
      <div class="pop-row">
        <button class="btn btn-primary btn-sm" onclick="askStillHere()">Still Here</button>
        <button class="btn btn-green  btn-sm"  onclick="askMarkCleaned()">Mark Cleaned</button>
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
  db.update(id,{timestamp:Date.now()});
  if(markers[id])markers[id].setStyle({fillColor:ageColor(0)});
}
function confirmMarkCleaned(){
  const id=dialogReportId; closeDialog();
  db.markCleaned(id); removeMarker(id);
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
    hit=rows.filter(r=>inPoly({lat:r.latitude,lng:r.longitude},drawPts));
  else if(mode==='route'&&drawPts.length>=2)
    hit=rows.filter(r=>{
      for(let i=0;i<drawPts.length-1;i++)
        if(distToSeg({lat:r.latitude,lng:r.longitude},drawPts[i],drawPts[i+1])<=CFG.proximity)return true;
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
      pulseMarkers[id]=L.circleMarker([r.latitude,r.longitude],{
        radius:9,fillColor:'transparent',color:'#4fbfbc',weight:2.5,opacity:1,fillOpacity:0,className:'pulse-ring',
      }).addTo(pl);
      affectedIds.add(id);
    }
  }
}

// ── CLEANUP MEASUREMENTS ──────────────────────────────────────────────────
function polygonAreaSqYards(pts){
  const R=6371000,rad=Math.PI/180;
  const lat0=pts.reduce((s,p)=>s+p.lat,0)/pts.length*rad;
  const cosLat=Math.cos(lat0);
  let area=0;
  for(let i=0;i<pts.length;i++){
    const j=(i+1)%pts.length;
    const xi=pts[i].lng*rad*R*cosLat,yi=pts[i].lat*rad*R;
    const xj=pts[j].lng*rad*R*cosLat,yj=pts[j].lat*rad*R;
    area+=xi*yj-xj*yi;
  }
  return Math.abs(area/2)*1.19599;
}
function routeDistanceMiles(pts){
  let d=0;
  for(let i=0;i<pts.length-1;i++)
    d+=L.latLng(pts[i].lat,pts[i].lng).distanceTo([pts[i+1].lat,pts[i+1].lng]);
  return d/1609.344;
}

// ── CLEANUP HINT ──────────────────────────────────────────────────────────
function updateHint(){
  const n=drawPts.length,min=mode==='area'?3:2,noun=mode==='area'?'point':'waypoint';
  let hint;
  if(mode==='area'&&n>=3){
    hint=`${Math.round(polygonAreaSqYards(drawPts)).toLocaleString()} sq yd`;
  } else if(mode==='route'&&n>=2){
    hint=`${routeDistanceMiles(drawPts).toFixed(2)} mi`;
  } else {
    hint=`${n} ${noun}${n!==1?'s':''}${n<min?` — need at least ${min}`:''}`;
  }
  document.getElementById('cleanup-hint').textContent=hint;
  document.getElementById('btn-submit').disabled=(n<min);
  document.getElementById('btn-undo').disabled=(!history.length||draggingIdx!==null);
}

// ── SUBMIT CLEANUP ────────────────────────────────────────────────────────
async function submitCleanup(){
  const rows=db.getAll();
  let clean=[];
  if(mode==='area')clean=rows.filter(r=>inPoly({lat:r.latitude,lng:r.longitude},drawPts));
  else clean=rows.filter(r=>{
    for(let i=0;i<drawPts.length-1;i++)
      if(distToSeg({lat:r.latitude,lng:r.longitude},drawPts[i],drawPts[i+1])<=CFG.proximity)return true;
    return false;
  });
  const n=clean.length;
  const body=n===0
    ?`No active reports in that ${mode==='area'?'area':'route corridor'}. Submit anyway?`
    :`Mark ${n} report${n!==1?'s':''} as cleaned?`;
  if(!await ask('Submit Cleanup?',body))return;
  const ids=clean.map(r=>r.id);
  db.markCleanedMany(ids); ids.forEach(removeMarker); exitCleanup();
}
function exitCleanup(){setMode('report');}

// ── MODE SWITCHING ────────────────────────────────────────────────────────
const MODES={
  report:{label:'Report',       color:'#4fbfbc',glow:'rgba(79,191,188,.28)',
    info:'Tap anywhere on the map to add a new litter report.<br><br>Tap an existing marker to confirm it\'s still there or to mark it as cleaned up.<br><br>Reports fade from red to yellow over 14 days and are automatically removed.'},
  area:  {label:'Area Cleanup', color:'#d97706',glow:'rgba(217,119,6,.28)',
    info:'Tap points on the map to draw a polygon around your cleanup area.<br><br>Drag any point to reshape the polygon. Reports inside the area will be marked as cleaned.<br><br>You need at least 3 points to submit.'},
  route: {label:'Route Cleanup',color:'#7c3aed',glow:'rgba(124,58,237,.28)',
    info:'Tap to add waypoints along your cleanup route.<br><br>Drag points to adjust the path. Reports within 5 yd of the route will be marked as cleaned.<br><br>You need at least 2 waypoints to submit.'},
};
function setMode(m){
  closeDialog(); closeInfo();
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

// ── INFO PANEL ────────────────────────────────────────────────────────────
let infoOpen=false;
function toggleInfo(){infoOpen?closeInfo():openInfo();}
function openInfo(){
  infoOpen=true;
  const cfg=MODES[mode];
  document.getElementById('info-title').textContent=cfg.label;
  document.getElementById('info-body').innerHTML=cfg.info;
  document.getElementById('info-panel').classList.remove('hidden');
}
function closeInfo(){
  if(!infoOpen)return;
  infoOpen=false;
  document.getElementById('info-panel').classList.add('hidden');
}

// ── GEOLOCATION ───────────────────────────────────────────────────────────
function jumpToLocation(){
  if(!locActive){
    map.locate({watch:true,setView:false,enableHighAccuracy:true});
    locActive=true;
  }
  if(locLatLng)map.setView([locLatLng.lat,locLatLng.lng],Math.max(map.getZoom(),18));
  else recenterPending=true;
}
function onLocationFound(e){
  const{lat,lng}=e.latlng;
  locLatLng={lat,lng};
  if(recenterPending){recenterPending=false;map.setView([lat,lng],Math.max(map.getZoom(),18));}
  locLayer.clearLayers();
  if(e.accuracy>10){
    L.circle([lat,lng],{
      radius:e.accuracy,color:'#2563eb',weight:1,
      fillColor:'#2563eb',fillOpacity:.08,opacity:.25,interactive:false,
    }).addTo(locLayer);
  }
  const dot=L.marker([lat,lng],{
    icon:L.divIcon({html:'<div class="loc-dot"></div>',className:'',iconSize:[14,14],iconAnchor:[7,7]}),
    zIndexOffset:100,
  }).addTo(locLayer);
  dot.on('click',ev=>{
    L.DomEvent.stopPropagation(ev);
    if(mode!=='report')return;
    if(dialogState!==null){closeDialog();return;}
    handleReportTap(locLatLng.lat,locLatLng.lng);
  });
}
function onLocationError(){
  const btn=document.getElementById('btn-geolocate');
  btn.classList.add('geolocate-err');
  setTimeout(()=>btn.classList.remove('geolocate-err'),1500);
}

// ── BOOT ──────────────────────────────────────────────────────────────────
initMap();
