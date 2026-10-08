import * as THREE from 'three';
import {PointerLockControls} from 'three/addons/controls/PointerLockControls.js';

const CFG={
  SIZE:51,CELL:4,WALL_H:3.1,EYE:1.62,R:.3,
  WALK:3.1,RUN:5.4,BOB_AMP:.045,BOB_FREQ:9,STEP:1/60,
  FOG:[0x171406,3,40],LIGHTS:9,LIGHT_RANGE:15,FIXTURE_EVERY:3,
  M_WANDER:1.5,M_STALK:2.0,M_HUNT:5.8,M_FLEE:18,
  WAKE:18,BEAM_RANGE:24,BEAM_ANGLE:.3,
  DRAIN:1/100,CHARGE:1/300
};
const T={FLOOR:0,WALL:1,PILLAR:2};
const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const rnd=(a,b)=>a+Math.random()*(b-a);
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
const V1=new THREE.Vector3(),V2=new THREE.Vector3(),V3=new THREE.Vector3(),FWD=new THREE.Vector3();

const Tex={
  make(size,fn){
    const c=document.createElement('canvas');c.width=c.height=size;
    fn(c.getContext('2d'),size);
    const t=new THREE.CanvasTexture(c);
    t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
    return t;
  },
  noise(g,s,n,a){
    for(let i=0;i<n;i++){
      const v=rnd(45,220)|0;
      g.fillStyle=`rgba(${v},${v*.92|0},${v*.5|0},${a})`;
      g.fillRect(Math.random()*s,Math.random()*s,rnd(.5,2.2),rnd(.5,2.2));
    }
  },
  blot(g,x,y,rx,ry,c0,c1){
    const gr=g.createRadialGradient(x,y,0,x,y,Math.max(rx,ry));
    gr.addColorStop(0,c0);gr.addColorStop(.4,c1);gr.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=gr;g.beginPath();g.ellipse(x,y,rx,ry,rnd(0,Math.PI),0,Math.PI*2);g.fill();
  },
  wall(seed){return this.make(512,(g,s)=>{
    const P=['#c8b55c','#c5b05a','#d0bc69','#c0aa51'];g.fillStyle=P[seed%4];g.fillRect(0,0,s,s);
    for(let x=0;x<s;x++){g.strokeStyle=`rgba(70,55,18,${.018+Math.random()*.035})`;g.beginPath();g.moveTo(x,0);g.lineTo(x+Math.sin(x*.12)*2,s);g.stroke()}
    for(let x=0;x<s;x+=32){g.fillStyle='rgba(120,100,30,.10)';g.fillRect(x,0,12,s)}
    g.strokeStyle='rgba(95,76,22,.26)';g.lineWidth=1.4;
    for(let y=16;y<s;y+=32)for(let x=16;x<s;x+=32){const w=(Math.random()-.5)*1.8;g.beginPath();g.moveTo(x,y-7+w);g.lineTo(x+5,y);g.lineTo(x,y+7-w);g.lineTo(x-5,y);g.closePath();g.stroke()}
    g.fillStyle='rgba(60,46,14,.22)';g.fillRect(s/2-1,0,1.5,s);g.fillStyle='rgba(255,240,170,.08)';g.fillRect(s/2+1,0,2,s);
    for(let i=0;i<3+seed;i++){const x=rnd(0,s),h=rnd(60,240),gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,'rgba(80,60,15,.28)');gr.addColorStop(1,'rgba(80,60,15,0)');g.fillStyle=gr;g.fillRect(x,0,rnd(10,45),h)}
    const bd=g.createLinearGradient(0,s,0,s-90);bd.addColorStop(0,'rgba(55,45,14,.35)');bd.addColorStop(1,'rgba(55,45,14,0)');g.fillStyle=bd;g.fillRect(0,s-90,s,90);
    for(let i=0;i<12;i++)this.blot(g,rnd(-30,s+30),rnd(-30,s+30),rnd(8,62),rnd(5,35),`rgba(${55+rnd(0,40)|0},${48+rnd(0,30)|0},${12+rnd(0,15)|0},${rnd(.08,.2)})`,`rgba(88,70,22,${rnd(.025,.09)})`);
    for(let i=0;i<260;i++){g.fillStyle=`rgba(${40+rnd(0,25)|0},${45+rnd(0,25)|0},20,${rnd(.1,.35)})`;g.fillRect(rnd(0,s),s-Math.abs(rnd(-1,1)*rnd(0,120)),rnd(1,3),rnd(1,3))}
    this.noise(g,s,9000,.028);
  })},
  carpet(seed){return this.make(512,(g,s)=>{
    g.fillStyle=['#b5a059','#ad9751','#bfa961'][seed%3];g.fillRect(0,0,s,s);
    for(let i=0;i<s;i+=4){g.strokeStyle=`rgba(110,85,20,${rnd(.06,.14)})`;g.beginPath();g.moveTo(i,0);g.lineTo(i,s);g.stroke();g.beginPath();g.moveTo(0,i);g.lineTo(s,i);g.stroke()}
    for(let i=0;i<18000;i++){const v=rnd(60,150);g.fillStyle=`rgba(${v},${v*.85|0},${v*.35|0},${rnd(.05,.18)})`;g.fillRect(Math.random()*s,Math.random()*s,rnd(1,2.5),rnd(1,2.5))}
    for(let i=0;i<12;i++)this.blot(g,rnd(0,s),rnd(0,s),rnd(20,90),rnd(20,90),'rgba(45,35,10,.16)','rgba(45,35,10,0)');
  })},
  ceiling(){return this.make(256,(g,s)=>{
    g.fillStyle='#d4cda9';g.fillRect(0,0,s,s);this.noise(g,s,4000,.08);
    g.strokeStyle='rgba(88,82,60,.45)';g.lineWidth=5;g.strokeRect(0,0,s,s);g.lineWidth=3;g.beginPath();g.moveTo(s/2,0);g.lineTo(s/2,s);g.moveTo(0,s/2);g.lineTo(s,s/2);g.stroke();
  })},
  smoke(){return this.make(64,(g,s)=>{
    const gr=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    gr.addColorStop(0,'rgba(0,0,0,.9)');gr.addColorStop(.5,'rgba(0,0,0,.45)');gr.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=gr;g.fillRect(0,0,s,s);
  })}
};

const MATS={};
function buildMaterials(){
  MATS.walls=[0,1,2,3].map(i=>new THREE.MeshLambertMaterial({map:Tex.wall(i)}));
  MATS.floors=[0,1,2].map(i=>new THREE.MeshLambertMaterial({map:Tex.carpet(i)}));
  MATS.ceil=new THREE.MeshLambertMaterial({map:Tex.ceiling()});
  const pt=MATS.walls[1].map.clone();pt.repeat.set(.35,1);pt.needsUpdate=true;
  MATS.pillar=new THREE.MeshLambertMaterial({map:pt});
  MATS.metal=new THREE.MeshLambertMaterial({color:0x8d8971});
  MATS.recess=new THREE.MeshLambertMaterial({color:0x4a4636});
  MATS.cap=new THREE.MeshLambertMaterial({color:0x35342c});
  MATS.tube=new THREE.MeshBasicMaterial({color:0xffffff});
  MATS.smoke=Tex.smoke();
}

class Maze{
  constructor(n){this.n=n}
  generate(){
    const n=this.n,g=Array.from({length:n},()=>new Array(n).fill(T.WALL)),st=[[1,1]];
    g[1][1]=T.FLOOR;
    while(st.length){
      const [x,y]=st[st.length-1],o=[];
      for(const [dx,dy] of DIRS){
        const X=x+dx*2,Y=y+dy*2;
        if(X>0&&Y>0&&X<n-1&&Y<n-1&&g[X][Y]===T.WALL)o.push([dx,dy]);
      }
      if(!o.length){st.pop();continue}
      const [dx,dy]=o[Math.random()*o.length|0];
      g[x+dx][y+dy]=g[x+dx*2][y+dy*2]=T.FLOOR;
      st.push([x+dx*2,y+dy*2]);
    }
    for(let x=1;x<n-1;x++)for(let y=1;y<n-1;y++)if(g[x][y]===T.WALL&&(x+y)%2===1&&Math.random()<.12)g[x][y]=T.FLOOR;
    const rooms=[];
    const carve=(w,h)=>{
      const x=2+Math.random()*(n-w-4)|0,y=2+Math.random()*(n-h-4)|0;
      for(let a=x;a<x+w;a++)for(let b=y;b<y+h;b++)g[a][b]=T.FLOOR;
      rooms.push([x,y,w,h]);
    };
    for(let i=0;i<4;i++)carve(7+(Math.random()*5|0),7+(Math.random()*5|0));
    for(let i=0;i<10;i++)carve(3+(Math.random()*3|0),3+(Math.random()*3|0));
    for(const [x,y,w,h] of rooms)if(w>=7&&h>=7)for(let a=x+2;a<x+w-1;a+=3)for(let b=y+2;b<y+h-1;b+=3)if(Math.random()<.55)g[a][b]=T.PILLAR;
    let sp={x:n>>1,y:n>>1},best=1e9;
    for(let x=1;x<n-1;x++)for(let y=1;y<n-1;y++)if(g[x][y]===T.FLOOR){const d=Math.hypot(x-n/2,y-n/2);if(d<best){best=d;sp={x,y}}}
    this.seal(g,sp.x,sp.y);
    return{grid:g,spawn:sp};
  }
  seal(g,sx,sy){
    const n=this.n,seen=new Uint8Array(n*n),st=[sx*n+sy];seen[sx*n+sy]=1;
    while(st.length){
      const id=st.pop(),x=id/n|0,y=id%n;
      for(const [dx,dy] of DIRS){
        const X=x+dx,Y=y+dy,k=X*n+Y;
        if(X>=0&&Y>=0&&X<n&&Y<n&&!seen[k]&&g[X][Y]!==T.WALL){seen[k]=1;st.push(k)}
      }
    }
    for(let x=0;x<n;x++)for(let y=0;y<n;y++)if(!seen[x*n+y])g[x][y]=T.WALL;
  }
}

class World{
  constructor(scene,data){this.scene=scene;this.grid=data.grid;this.n=data.grid.length;this.root=new THREE.Group();scene.add(this.root);this.fixtures=[];this.dirty=false;this.build()}
  w(i){return i*CFG.CELL}
  inst(geo,mat,items,rotX=0){
    const mesh=new THREE.InstancedMesh(geo,mat,Math.max(1,items.length)),m=new THREE.Matrix4(),r=new THREE.Matrix4().makeRotationX(rotX);
    mesh.count=items.length;
    items.forEach(([x,y,z],i)=>{m.makeTranslation(x,y,z);if(rotX)m.multiply(r);mesh.setMatrixAt(i,m)});
    mesh.instanceMatrix.needsUpdate=true;this.root.add(mesh);return mesh;
  }
  build(){
    const C=CFG.CELL,H=CFG.WALL_H,walls=[[],[],[],[]],floors=[[],[],[]],ceil=[],pillars=[],fx=[];
    for(let x=0;x<this.n;x++)for(let y=0;y<this.n;y++){
      const t=this.grid[x][y],X=this.w(x),Z=this.w(y);
      if(t===T.WALL){if(this.open(x+1,y)||this.open(x-1,y)||this.open(x,y+1)||this.open(x,y-1))walls[(x*13+y*7)%4].push([X,H/2,Z]);continue}
      floors[(x*7+y*3)%3].push([X,0,Z]);ceil.push([X,H,Z]);
      if(t===T.PILLAR)pillars.push([X,H/2,Z]);
      else if(x%CFG.FIXTURE_EVERY===0&&y%CFG.FIXTURE_EVERY===0&&Math.random()<.92)fx.push([X,Z]);
    }
    const box=new THREE.BoxGeometry(C,H,C),tile=new THREE.PlaneGeometry(C,C);
    walls.forEach((c,i)=>this.inst(box,MATS.walls[i],c));
    floors.forEach((c,i)=>this.inst(tile,MATS.floors[i],c,-Math.PI/2));
    this.inst(tile,MATS.ceil,ceil,Math.PI/2);
    this.inst(new THREE.BoxGeometry(C*.34,H,C*.34),MATS.pillar,pillars);
    const y=H-.05,housing=[],recess=[],tubes=[],caps=[];
    for(const [X,Z] of fx){
      housing.push([X,y,Z]);recess.push([X,y-.05,Z]);
      for(const dz of[-.19,.19]){tubes.push([X,y-.075,Z+dz]);caps.push([X-.79,y-.075,Z+dz],[X+.79,y-.075,Z+dz])}
      this.fixtures.push({pos:new THREE.Vector3(X,H-.25,Z),stress:0,dead:false,dying:0,flick:1,phase:Math.random()*10,idx:this.fixtures.length});
    }
    this.inst(new THREE.BoxGeometry(1.9,.08,.8),MATS.metal,housing);
    this.inst(new THREE.BoxGeometry(1.7,.04,.62),MATS.recess,recess);
    const tg=new THREE.CylinderGeometry(.04,.04,1.5,8);tg.rotateZ(Math.PI/2);
    const cg=new THREE.CylinderGeometry(.06,.06,.08,8);cg.rotateZ(Math.PI/2);
    this.inst(cg,MATS.cap,caps);
    this.tubes=this.inst(tg,MATS.tube,tubes);
    this.tubeColor=new THREE.Color();
    for(let i=0;i<tubes.length;i++)this.tubes.setColorAt(i,this.tubeColor.setRGB(1,.96,.8));
    if(this.tubes.instanceColor)this.tubes.instanceColor.needsUpdate=true;
  }
  setTube(f,b){
    const c=this.tubeColor.setRGB(.06+b*.94,.06+b*.9,.05+b*.75);
    this.tubes.setColorAt(f.idx*2,c);this.tubes.setColorAt(f.idx*2+1,c);this.dirty=true;
  }
  dispose(){this.root.traverse(o=>{if(o.geometry)o.geometry.dispose()});this.scene.remove(this.root)}
  open(x,y){const t=this.grid[x]?.[y];return t!==undefined&&t!==T.WALL}
  cell(px,pz){return{x:Math.round(px/CFG.CELL),y:Math.round(pz/CFG.CELL)}}
  box(x,y){
    const t=this.grid[x]?.[y],h=CFG.CELL/2,cx=this.w(x),cz=this.w(y);
    if(t===undefined||t===T.WALL)return[cx-h,cz-h,cx+h,cz+h];
    if(t===T.PILLAR){const p=CFG.CELL*.17;return[cx-p,cz-p,cx+p,cz+p]}
    return null;
  }
  collides(px,pz,r){
    const tc=v=>Math.round(v/CFG.CELL);
    for(let x=tc(px-r);x<=tc(px+r);x++)for(let y=tc(pz-r);y<=tc(pz+r);y++){
      const b=this.box(x,y);
      if(b&&px+r>b[0]&&px-r<b[2]&&pz+r>b[1]&&pz-r<b[3])return true;
    }
    return false;
  }
  los(ax,az,bx,bz){
    const d=Math.hypot(bx-ax,bz-az),s=Math.ceil(d/.5);
    for(let i=1;i<s;i++){
      const t=i/s,c=this.cell(ax+(bx-ax)*t,az+(bz-az)*t);
      const cell=this.grid[c.x]?.[c.y];
      if(cell!==T.FLOOR&&cell!==T.PILLAR)return false;
    }
    return true;
  }
}

/* ===================== PUDDLE / SLIME SLICK ===================== */
class GooTrail{
  constructor(scene){
    this.count=700;this.idx=0;
    this.geo=new THREE.PlaneGeometry(1,1);this.geo.rotateX(-Math.PI/2);
    this.tex=GooTrail.makeTexture();
    this.mat=new THREE.MeshStandardMaterial({color:0x020202,roughness:.08,metalness:.15,map:this.tex,alphaMap:this.tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
    this.mesh=new THREE.InstancedMesh(this.geo,this.mat,this.count);
    this.mesh.frustumCulled=false;this.mesh.renderOrder=1;
    this.m=new THREE.Matrix4();this.q=new THREE.Quaternion();this.s=new THREE.Vector3();this.p=new THREE.Vector3();this.up=new THREE.Vector3(0,1,0);
    scene.add(this.mesh);this.clear();
  }
  static makeTexture(){
    // White = liquid (alpha), black = dry. Organic pooled blobs with soft bled edges.
    const s=256,c=document.createElement('canvas');c.width=c.height=s;const g=c.getContext('2d');
    g.fillStyle='#000';g.fillRect(0,0,s,s);
    const blob=(x,y,r,a)=>{const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,`rgba(255,255,255,${a})`);gr.addColorStop(.55,`rgba(255,255,255,${a*.85})`);gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill()};
    g.filter='blur(3px)';
    blob(s/2,s/2,s*.3,1);
    for(let i=0;i<14;i++){const a=rnd(0,Math.PI*2),d=rnd(10,58);blob(s/2+Math.cos(a)*d,s/2+Math.sin(a)*d,rnd(18,44),rnd(.7,1))}
    for(let i=0;i<9;i++){const a=rnd(0,Math.PI*2);let x=s/2,y=s/2,r=rnd(10,16);for(let k=0;k<7;k++){x+=Math.cos(a)*r*.9;y+=Math.sin(a)*r*.9;r*=.78;if(Math.hypot(x-s/2,y-s/2)>s*.44)break;blob(x,y,r,.95)}}
    for(let i=0;i<22;i++){const a=rnd(0,Math.PI*2),d=rnd(70,108);blob(s/2+Math.cos(a)*d,s/2+Math.sin(a)*d,rnd(2,7),rnd(.6,1))}
    g.filter='none';
    // sharpen the bleed into a wet meniscus edge
    const img=g.getImageData(0,0,s,s),D=img.data;
    for(let i=0;i<D.length;i+=4){const v=D[i]/255,e=clamp((v-.18)/.35,0,1),o=Math.pow(e,.7)*255;D[i]=D[i+1]=D[i+2]=o;D[i+3]=255}
    g.putImageData(img,0,0);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.NoColorSpace;return t;
  }
  clear(){
    this.idx=0;this.m.makeScale(0,0,0);
    for(let i=0;i<this.count;i++)this.mesh.setMatrixAt(i,this.m);
    this.mesh.instanceMatrix.needsUpdate=true;
  }
  drop(x,z,sx,sz,yaw=rnd(0,Math.PI*2)){
    this.q.setFromAxisAngle(this.up,yaw);
    this.p.set(x,.012,z);this.s.set(sx,1,sz);
    this.m.compose(this.p,this.q,this.s);
    this.mesh.setMatrixAt(this.idx,this.m);
    this.idx=(this.idx+1)%this.count;
    this.mesh.instanceMatrix.needsUpdate=true;
  }
  // footfall smears behind the entity, elongated along travel direction
  trail(x,z,dirX=0,dirZ=0,speedK=1){
    const yaw=Math.atan2(-dirZ,dirX)+rnd(-.25,.25),len=rnd(.7,1.2)*(1+speedK*.8),wid=rnd(.45,.8);
    this.drop(x+rnd(-.25,.25),z+rnd(-.25,.25),len,wid,yaw);
    if(Math.random()<.3)this.drop(x+rnd(-.6,.6),z+rnd(-.6,.6),rnd(.25,.45),rnd(.25,.45));
  }
  // large pooled slick where it lingered
  pool(x,z,size=1){
    this.drop(x,z,rnd(2,2.8)*size,rnd(1.7,2.5)*size);
    const n=2+(Math.random()*3|0);
    for(let i=0;i<n;i++){const a=rnd(0,Math.PI*2),d=rnd(.8,1.5)*size;this.drop(x+Math.cos(a)*d,z+Math.sin(a)*d,rnd(.6,1.2)*size,rnd(.5,1)*size)}
  }
}

class Lighting{
  constructor(scene){
    this.pool=[];
    for(let i=0;i<CFG.LIGHTS;i++){const l=new THREE.PointLight(0xffe9a7,0,CFG.LIGHT_RANGE,1.7);l.userData.f=null;scene.add(l);this.pool.push(l)}
    this.amb=new THREE.AmbientLight(0x71673b,.32);this.hemi=new THREE.HemisphereLight(0xffefb0,0x151208,.22);scene.add(this.amb,this.hemi);
    this.timer=0;this.near=[];this.maxStress=0;this.dark=false;
  }
  setDark(on){
    this.dark=on;this.amb.intensity=on?0:.32;this.hemi.intensity=on?0:.22;
    if(on){for(const l of this.pool)l.intensity=0;const w=this.world;if(w){for(const f of w.fixtures)w.setTube(f,0);w.tubes.instanceColor.needsUpdate=true;w.dirty=false}}
  }
  setWorld(world){this.world=world;this.timer=0;for(const l of this.pool){l.userData.f=null;l.intensity=0}}
  update(dt,pos,monster){
    if(this.dark){this.maxStress=0;return}
    const w=this.world,F=w.fixtures,mp=monster.active?monster.pos:null;
    if((this.timer-=dt)<=0){
      this.timer=.2;
      this.near=F.filter(f=>!f.dead&&Math.abs(f.pos.x-pos.x)<30&&Math.abs(f.pos.z-pos.z)<30).sort((a,b)=>a.pos.distanceToSquared(pos)-b.pos.distanceToSquared(pos)).slice(0,this.pool.length);
      this.pool.forEach((l,i)=>{const f=this.near[i];l.userData.f=f||null;if(f)l.position.copy(f.pos);else l.intensity=0});
    }
    let maxS=0;
    for(const f of F){
      if(f.dead)continue;
      let target=0;
      if(mp&&monster.mode!=='stalk'){const d=Math.hypot(f.pos.x-mp.x,f.pos.z-mp.z);target=d<11?clamp((11-d)/8,0,1):0}
      f.stress+=(target-f.stress)*Math.min(1,dt*(target>f.stress?.8:.3));
      if(f.stress<.02&&f.flick===1&&Math.random()>.0015)continue;
      f.phase+=dt;const s=f.stress;let b=1;
      if(s<.3)b=Math.random()<.004+s*.03?rnd(.55,.85):1;
      else if(s<.6)b=(Math.sin(f.phase*47)>.6?.55:1)*(Math.random()<.06?.3:1);
      else if(s<.88)b=Math.random()<.35?rnd(0,.25):rnd(.7,1);
      else{f.dying+=dt;b=Math.random()<.6?0:rnd(.2,.6);if(f.dying>1.6){f.dead=true;b=0;monster.g.audio.pop(f.pos)}}
      if(s<.88)f.dying=Math.max(0,f.dying-dt);
      f.flick+=(b-f.flick)*.6;if(Math.abs(f.flick-1)<.02&&s<.02)f.flick=1;
      w.setTube(f,f.dead?0:f.flick);
      if(f.pos.distanceToSquared(pos)<144)maxS=Math.max(maxS,s);
    }
    for(const f of F)if(f.dead&&f.flick!==0){f.flick=0;w.setTube(f,0)}
    for(const l of this.pool){const f=l.userData.f;l.intensity=f&&!f.dead?3.9*f.flick:0}
    if(w.dirty){w.tubes.instanceColor.needsUpdate=true;w.dirty=false}
    this.maxStress=maxS;
  }
}

class Player{
  constructor(g){
    this.g=g;this.controls=new PointerLockControls(g.camera,document.body);this.keys={};this.bob=0;this.moving=false;this.dir=new THREE.Vector3();this.right=new THREE.Vector3();
    addEventListener('keydown',e=>{this.keys[e.code]=true;if(e.code==='KeyF'&&!e.repeat&&this.controls.isLocked)g.flash.toggle();if(e.code==='KeyR'&&!this.controls.isLocked&&!g.dead)g.newLevel()});
    addEventListener('mousedown',e=>{if(e.button===0&&this.controls.isLocked&&!g.dead&&e.target.tagName==='CANVAS')g.cameraBlast()});
    addEventListener('keydown',e=>{if(e.code==='KeyC'&&!e.repeat&&this.controls.isLocked&&!g.dead)g.cameraBlast()});
    addEventListener('keyup',e=>this.keys[e.code]=false);addEventListener('blur',()=>this.keys={});
    // --- MOBILE TOUCH CONTROLS ---
    const bindBtn = (id, code) => {
      const btn = $(id);
      if(!btn) return;
      btn.addEventListener('touchstart', e => { e.preventDefault(); this.keys[code] = true; });
      btn.addEventListener('touchend', e => { e.preventDefault(); this.keys[code] = false; });
    };
    bindBtn('btn-w', 'KeyW'); bindBtn('btn-a', 'KeyA'); bindBtn('btn-s', 'KeyS'); bindBtn('btn-d', 'KeyD'); 
    bindBtn('btn-shift', 'ShiftLeft'); bindBtn('btn-e', 'KeyE');
    
    $('btn-f')?.addEventListener('touchstart', e => { e.preventDefault(); g.flash.toggle(); });
    $('btn-c')?.addEventListener('touchstart', e => { e.preventDefault(); g.cameraBlast(); });

    // Touch Look Camera
    let tX, tY;
    document.addEventListener('touchstart', e => {
      if(e.touches.length === 1 && e.target.tagName === 'CANVAS') { 
        tX = e.touches[0].pageX; tY = e.touches[0].pageY; 
      }
    }, {passive: false});
    document.addEventListener('touchmove', e => {
      if(e.touches.length === 1 && e.target.tagName === 'CANVAS') {
        e.preventDefault();
        const dx = e.touches[0].pageX - tX, dy = e.touches[0].pageY - tY;
        tX = e.touches[0].pageX; tY = e.touches[0].pageY;
        
        const euler = new THREE.Euler(0, 0, 0, 'YXZ');
        euler.setFromQuaternion(g.camera.quaternion);
        euler.y -= dx * 0.005; euler.x -= dy * 0.005;
        euler.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, euler.x));
        g.camera.quaternion.setFromEuler(euler);
      }
    }, {passive: false});
  }
  
  get running(){return (this.keys.ShiftLeft||this.keys.ShiftRight)&&!this.keys.KeyE} // winding disables sprint
  get winding(){return!!this.keys.KeyE}
  update(dt){
    if(!this.controls.isLocked||this.g.dead){this.moving=false;return}
    const k=this.keys,wind=this.winding&&!this.g.dark,
    s=(wind?CFG.WALK*.4:(this.running?CFG.RUN:CFG.WALK)),
    f=(k.KeyW?1:0)-(k.KeyS?1:0),sd=(k.KeyD?1:0)-(k.KeyA?1:0),cam=this.g.camera;
    cam.getWorldDirection(this.dir);this.dir.y=0;this.dir.normalize();this.right.crossVectors(this.dir,cam.up);
    const m=this.dir.multiplyScalar(f).add(this.right.multiplyScalar(sd));this.moving=m.lengthSq()>0;if(this.moving)m.normalize().multiplyScalar(s*dt);
    const p=cam.position,r=CFG.R,w=this.g.world;
    if(!w.collides(p.x+m.x,p.z,r))p.x+=m.x;if(!w.collides(p.x,p.z+m.z,r))p.z+=m.z;
    this.bob=this.moving?this.bob+dt*CFG.BOB_FREQ*(s/CFG.WALK):this.bob*.9;
    p.y=CFG.EYE+Math.sin(this.bob)*CFG.BOB_AMP*(this.moving?1:Math.min(1,Math.abs(this.bob)));
  }
}

class Flashlight{
  constructor(g){
    this.g=g;this.on=true;this.battery=1;this.sway=new THREE.Vector2();this.st=new THREE.Vector2();this.flk=1;
    this.spot=new THREE.SpotLight(0xfff2d0,0,CFG.BEAM_RANGE,Math.PI/8,.55,1.3);
    this.spot.position.set(.05,-.05,0);
    this.target=new THREE.Object3D();this.target.position.set(0,0,-1);this.spot.add(this.target);this.spot.target=this.target;
    this.fill=new THREE.PointLight(0xffe8bd,0,3,2);g.camera.add(this.spot,this.fill);
    this.bar=$('bar').firstElementChild;this.pct=$('pct');this.dirW=new THREE.Vector3();this.msg=$('crank-msg');
  }
  toggle(){if(this.g.dark)return;if(!this.on&&this.battery<=0){this.g.say('BATTERY DEAD');return}this.on=!this.on;this.g.say(this.on?'FLASHLIGHT ON':'FLASHLIGHT OFF');this.g.audio.click()}
  update(dt){
    const winding=this.g.player.keys.KeyE&&!this.g.dark;
    if(winding){this.battery=Math.min(1,this.battery+dt*CFG.CHARGE);this.msg.style.display='inline-block';this.g.audio.windTick()}else this.msg.style.display='none';
    if(this.on){this.battery-=dt*CFG.DRAIN;if(this.battery<=0){this.battery=0;this.on=false;this.g.blackout()}}
    const p=this.g.player;this.st.set(p.moving?Math.sin(p.bob)*.03:0,p.moving?Math.cos(p.bob*2)*.02:0);this.sway.lerp(this.st,Math.min(1,dt*6));
    this.spot.rotation.set(this.sway.y,this.sway.x,0);
    this.flk=this.battery<.18&&Math.random()<.08?rnd(.1,.6):this.flk+(1-this.flk)*.3;
    const k=this.on?this.flk:0;this.spot.intensity=k*(5+this.battery*4);this.fill.intensity=k*.5;
    this.bar.style.width=(this.battery*100).toFixed(1)+'%';this.pct.textContent=Math.round(this.battery*100)+'%';
  }
  hits(p){
    if(!this.on||this.spot.intensity<.5)return false;
    const c=this.g.camera.position,tw=this.tw||(this.tw=new THREE.Vector3()),sw=this.sw||(this.sw=new THREE.Vector3()),to=this.to||(this.to=new THREE.Vector3());
    this.target.getWorldPosition(tw);this.spot.getWorldPosition(sw);this.dirW.subVectors(tw,sw).normalize();
    to.subVectors(p,c);const d=to.length();if(d>CFG.BEAM_RANGE||d<.01)return false;
    const ang=CFG.BEAM_ANGLE+Math.min(.35,.6/d);
    return to.multiplyScalar(1/d).dot(this.dirW)>Math.cos(ang)&&this.g.world.los(c.x,c.z,p.x,p.z);
  }
}

/* ===================== MONSTER: THE ELDRITCH SHADOW ===================== */
class Monster{
  constructor(g){
    this.g=g;this.group=new THREE.Group();g.scene.add(this.group);this.pos=this.group.position;
    this.active=false;this.mode='stalk';this.respawn=7;this.path=[];this.t=Math.random()*10;
    const N=CFG.SIZE*CFG.SIZE;
    this.prev=new Int32Array(N);this.q=new Int32Array(N);this.distMap=new Int32Array(N);
    this.dir=new THREE.Vector3(0,0,1);this.lastGoo=new THREE.Vector3();this.target=null;
    this.U={uTime:{value:0},uWarp:{value:1},uShudder:{value:0}};
    this.body=new THREE.Group();this.group.add(this.body);
    this.buildBody();this.buildShroud();this.buildEyes();
    this.straightT=0;this.straightLen=0;this.lastYaw=0;this.lureT=rnd(20,40);this.freeze=0;this.blood=0;this.pathT=0;this.spinT=0;this.group.visible=false;this.reset();
  }

  voidMat(sway){
    const m=new THREE.MeshStandardMaterial({color:0x000000,roughness:.22,metalness:.35,transparent:true,opacity:1,fog:true});
    m.onBeforeCompile=sh=>{
      Object.assign(sh.uniforms,this.U);sh.uniforms.uSway={value:sway};
      sh.vertexShader='uniform float uTime;uniform float uWarp;uniform float uShudder;uniform float uSway;\n'+sh.vertexShader.replace('#include <begin_vertex>',`
        vec3 transformed=vec3(position);
        float h=position.y;
        float n=sin(h*3.1+uTime*1.7)*.5+sin(h*7.3-uTime*2.9+position.x*4.)*.25+sin(h*13.-uTime*4.3+position.z*7.)*.12;
        float lean=uWarp*(.035+.09*uSway*clamp(2.4-h,0.,2.))*h*.45;
        transformed.x+=n*lean+sin(uTime*41.+h*23.)*.03*uShudder;
        transformed.z+=cos(h*2.3+uTime*1.3+position.x*3.)*lean+cos(uTime*37.+h*19.)*.03*uShudder;
        float breath=.07*sin(uTime*1.15)*smoothstep(1.4,1.95,h)*smoothstep(2.5,2.0,h);
        float drip=smoothstep(.55,0.,h)*(1.-uSway);
        transformed.xz*=1.+breath+drip*(.45+.3*sin(uTime*2.1+position.x*9.+position.z*5.));
        transformed.y-=drip*.04*(1.+sin(uTime*3.+position.x*11.));
        transformed.y*=1.+.035*sin(uTime*.7)*uWarp;`);
    };
    m.customProgramCacheKey=()=>'voidshadow'+sway;
    return m;
  }

  buildBody(){
    this.bodyMat=this.voidMat(0);this.limbMat=this.voidMat(1);
    const add=(geo,mat)=>{const o=new THREE.Mesh(geo,mat);this.body.add(o);return o};
    // elongated torso/neck/head silhouette
    const prof=[[0,1.0],[.13,1.02],[.16,1.18],[.12,1.5],[.15,1.75],[.23,2.02],[.21,2.28],[.09,2.38],[.05,2.47],[.1,2.56],[.13,2.7],[.11,2.84],[.06,2.93],[0,2.97]].map(([r,y])=>new THREE.Vector2(r,y));
    const torso=new THREE.LatheGeometry(prof,14);torso.scale(1,1,.62);
    add(torso,this.bodyMat);
    // thin unnatural legs that liquefy into the floor
    for(const sx of[-1,1]){const l=new THREE.CylinderGeometry(.045,.1,1.12,8,14);l.translate(sx*.1,.56,0);add(l,this.bodyMat)}
    // grotesquely long arms hanging almost to the floor + finger tendrils
    for(const sx of[-1,1]){
      const a=new THREE.CylinderGeometry(.06,.022,1.9,7,18);a.translate(0,-.95,0);a.rotateZ(sx*.09);a.translate(sx*.27,2.24,.02);add(a,this.limbMat);
      for(let f=0;f<3;f++){const t=new THREE.CylinderGeometry(.014,.002,rnd(.45,.65),5,8);t.translate(0,-t.parameters.height/2,0);t.rotateZ(sx*(.12+f*.06));t.rotateX((f-1)*.18);t.translate(sx*.45,.4,.02);add(t,this.limbMat)}
    }
    // tendrils trailing from the back
    for(let i=0;i<5;i++){const t=new THREE.CylinderGeometry(.035,.004,rnd(1.4,2.1),6,16);t.translate(0,-t.parameters.height/2,0);t.rotateX(-rnd(.15,.45));t.rotateZ(rnd(-.4,.4));t.translate(rnd(-.15,.15),rnd(2.0,2.35),-.1);add(t,this.limbMat)}
  }

  buildShroud(){
    this.puffs=[];
    for(let i=0;i<26;i++){
      const m=new THREE.SpriteMaterial({map:MATS.smoke,transparent:true,opacity:0,depthWrite:false,fog:true,rotation:rnd(0,6)});
      const s=new THREE.Sprite(m);this.group.add(s);
      s.userData={life:rnd(0,1),dur:rnd(2.2,4.2),a:rnd(0,Math.PI*2),r:rnd(.05,.55),y0:rnd(0,2.6),rise:rnd(.25,.7),size:rnd(.9,2.1),spin:rnd(-.4,.4)};
      this.puffs.push(s);
    }
  }

  buildEyes(){
    const c=document.createElement('canvas');c.width=c.height=64;
    const ctx=c.getContext('2d'),gr=ctx.createRadialGradient(32,32,0,32,32,32);
    gr.addColorStop(0,'rgba(255,240,220,1)');gr.addColorStop(.08,'rgba(255,60,20,1)');gr.addColorStop(.3,'rgba(200,10,0,.45)');gr.addColorStop(1,'rgba(120,0,0,0)');
    ctx.fillStyle=gr;ctx.fillRect(0,0,64,64);
    this.eyeMat=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),color:0xff2a10,transparent:true,opacity:0,depthWrite:false,fog:false,blending:THREE.AdditiveBlending});
    this.eyes=[];
    for(const sx of[-1,1]){const e=new THREE.Sprite(this.eyeMat);e.position.set(sx*.055,2.72,.13);this.body.add(e);this.eyes.push(e)}
  }

  reset(){
    this.active=false;this.group.visible=false;this.mode='stalk';this.respawn=rnd(6,11);this.path.length=0;
    this.lingerT=0;this.lingerAcc=0;this.pooled=false;this.travelling=false;this.peeking=false;
    this.seenT=0;this.litT=0;this.lostT=0;this.agonyT=0;this.pathT=0;this.floodT=0;this.dartCD=4;this.peekCD=15;this.speed=0;this.freeze=0;this.spinT=0;this.straightLen=0;this.straightT=0;
    this.dep||(this.dep=new Int32Array(CFG.SIZE*CFG.SIZE));
    $('danger').style.opacity=0;
  }
  // ---- camera flash / snapshot: freeze, hiss, vanish into the dark ----
  onFlash(camDir){
    if(!this.active||this.mode==='bloodlust')return;
    const g=this.g,c=g.camera.position,d=this.dist();if(d>26)return;
    g.camera.getWorldDirection(FWD);
    V3.set(this.pos.x-c.x,0,this.pos.z-c.z).normalize();
    const facing=V3.x*FWD.x+V3.z*FWD.z; // in the flash cone?
    if(facing<.55&&d>4)return; // too far off-axis to catch it
    if(d<26&&!g.world.los(c.x,c.z,this.pos.x,this.pos.z))return;
    this.freeze=Math.max(this.freeze,1);this.g.audio.hiss(this.pos);
    this.g.goo.pool(this.pos.x,this.pos.z,1.4);
    this.g.warn('IT HATES THE LIGHT',1200);
  }
  // ---- battery dead: no body, only eyes, faster than you ----
  enterBloodlust(){
    const g=this.g,w=g.world,c=g.camera.position,pc=w.cell(c.x,c.z);
    const first=!this.active; if(first){this.reset();this.active=true;this.group.visible=true;this.pos.set((pc.x+2)*CFG.CELL,0,pc.y*CFG.CELL);}
    this.mode='bloodlust';this.blood=0;this.path.length=0;this.freeze=0;
    this.lastGoo.copy(this.pos);
    this.flood(pc.x,pc.y);
    if(first||this.dist()>9)this.placeBehind(6);
    g.audio.roar(this.pos);
  }
  placeBehind(dist){
    const c=this.g.camera.position,w=this.g.world;this.flood(w.cell(c.x,c.z).x,w.cell(c.x,c.z).y);
    this.g.camera.getWorldDirection(FWD);
    this.search(12,(id,depth,X,Z)=>{
      if(w.los(c.x,c.z,X,Z))return -Infinity;
      V3.set(X-c.x,0,Z-c.z).normalize();
      const behind=-(V3.x*FWD.x+V3.z*FWD.z);
      return behind*6+clamp((dist-depth)/2,-4,4)+Math.random();
    });
    if(this.path.length){const t=this.path[this.path.length-1];this.pos.set((t/w.n|0)*CFG.CELL,0,(t%w.n)*CFG.CELL);this.path.length=0}
  }

  dist(){const c=this.g.camera.position;return Math.hypot(this.pos.x-c.x,this.pos.z-c.z)}
  openCount(x,y){const G=this.g.world.grid;let k=0;for(const[dx,dy]of DIRS)if(G[x+dx]?.[y+dy]===T.FLOOR)k++;return k}

  // BFS path-distance map from the player's cell (in cells)
  flood(cx,cy){
    const w=this.g.world,n=w.n,D=this.distMap,q=this.q;D.fill(-1);
    let h=0,t=0;const s=cx*n+cy;D[s]=0;q[t++]=s;
    while(h<t){
      const id=q[h++],x=id/n|0,y=id%n;
      for(const[dx,dy]of DIRS){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=n||Y>=n)continue;const k=X*n+Y;if(D[k]===-1&&w.grid[X][Y]===T.FLOOR){D[k]=D[id]+1;q[t++]=k}}
    }
  }

  // BFS from the monster; picks the best-scoring reachable cell and stores the path to it
  search(maxDepth,score,avoid=0){
    const w=this.g.world,n=w.n,prev=this.prev,q=this.q,dep=this.dep,D=this.distMap,m=w.cell(this.pos.x,this.pos.z);
    prev.fill(-1);const s=m.x*n+m.y;let h=0,t=0,best=-1,bestS=-Infinity;q[t++]=s;prev[s]=s;dep[s]=0;
    while(h<t){
      const id=q[h++],x=id/n|0,y=id%n;
      if(id!==s){const sc=score(id,dep[id],x*CFG.CELL,y*CFG.CELL);if(sc>bestS){bestS=sc;best=id}}
      if(dep[id]>=maxDepth)continue;
      for(const[dx,dy]of DIRS){
        const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=n||Y>=n)continue;const k=X*n+Y;
        if(prev[k]===-1&&w.grid[X][Y]===T.FLOOR&&!(avoid&&D[k]>=0&&D[k]<avoid)){prev[k]=id;dep[k]=dep[id]+1;q[t++]=k}
      }
    }
    this.path.length=0;if(best<0||bestS===-Infinity)return false;
    let cur=best;while(cur!==s){this.path.push(cur);cur=prev[cur]}this.path.reverse();return true;
  }

  spawn(){
    const g=this.g,c=g.camera.position,w=g.world,pc=w.cell(c.x,c.z);this.flood(pc.x,pc.y);g.camera.getWorldDirection(FWD);
    let best=null,bs=-Infinity;
    for(let x=1;x<w.n-1;x++)for(let y=1;y<w.n-1;y++){
      if(w.grid[x][y]!==T.FLOOR)continue;
      const X=x*CFG.CELL,Z=y*CFG.CELL,ex=X-c.x,ez=Z-c.z,e=Math.hypot(ex,ez),pd=this.distMap[x*w.n+y];
      if(e<20||e>32||pd<5||w.los(c.x,c.z,X,Z))continue;
      let s=Math.random()*10-Math.max(0,pd-12);if((ex*FWD.x+ez*FWD.z)/e<0)s+=8;
      if(s>bs){bs=s;best={X,Z}}
    }
    if(!best){this.respawn=2;return}
    this.reset();this.active=true;this.group.visible=true;
    this.pos.set(best.X,0,best.Z);this.lastGoo.copy(this.pos);
    this.group.rotation.y=Math.atan2(c.x-this.pos.x,c.z-this.pos.z);
    this.enterStalk(rnd(1,3));this.peekCD=rnd(10,20);
    g.goo.pool(this.pos.x,this.pos.z,1);
  }

  /* ---------- phase transitions ---------- */
  enterStalk(linger=0){
    this.mode='stalk';this.path.length=0;this.travelling=false;this.peeking=false;
    this.lingerT=linger;this.lingerAcc=0;this.pooled=false;this.pathT=0;
  }

  // Phase 2: burst laterally across / behind a corner, never straight at the player
  enterDart(){
    const c=this.g.camera.position,w=this.g.world,mx=this.pos.x-c.x,mz=this.pos.z-c.z,ml=Math.hypot(mx,mz)||1;
    const ok=this.search(4,(id,depth,X,Z)=>{
      if(w.los(c.x,c.z,X,Z))return -Infinity;
      const ex=X-this.pos.x,ez=Z-this.pos.z,el=Math.hypot(ex,ez)||1,dot=(ex*mx+ez*mz)/(el*ml);
      if(dot<-.5)return -Infinity;
      return (1-Math.abs(dot))*6-depth*1.5+Math.random();
    });
    if(!ok){this.enterRetreat(false);return}
    this.g.goo.pool(this.pos.x,this.pos.z,.7);
    this.mode='dart';this.dartCD=rnd(7,12);this.seenT=0;this.peeking=false;this.lingerT=0;this.travelling=false;
    this.g.audio.whoosh(this.pos);
  }

  // Phase 3: flee to the nearest hidden cell, away from the player
  enterRetreat(agony=true){
    const c=this.g.camera.position,w=this.g.world,D=this.distMap,mc=w.cell(this.pos.x,this.pos.z),md=Math.max(0,D[mc.x*w.n+mc.y]);
    if(!this.search(10,(id,depth,X,Z)=>w.los(c.x,c.z,X,Z)?-Infinity:(D[id]-md)*2-depth*.5+Math.random()*2,2))
      this.search(10,(id,depth)=>D[id]-md-depth*.2);
    this.mode='retreat';this.agonyT=agony?rnd(.4,.6):0;this.travelling=false;this.peeking=false;this.lingerT=0;this.seenT=0;
    if(agony){this.g.audio.screech(this.pos);this.g.glitch()}
  }

  // Phase 4: drop all stealth
  enterStrike(){
    this.mode='strike';this.lostT=0;this.pathT=0;this.path.length=0;this.peeking=false;this.lingerT=0;
    this.g.audio.roar(this.pos);this.g.glitch();this.g.warn('IT SEES YOU',1400);
  }
  // ---- lure: stand at the far end of a sightline, perfectly still ----
  enterLure(){
    const g=this.g,c=g.camera.position,w=g.world;
    const ok=this.search(25,(id,depth,X,Z)=>{
      const e=Math.hypot(X-c.x,Z-c.z);
      if(e<13||e>18||!w.los(c.x,c.z,X,Z))return -Infinity;
      // must be down a clear line with room behind it to slink around
      let hall=0;for(const[dx,dy]of DIRS)if(w.grid[(X/CFG.CELL|0)+dx]?.[(Z/CFG.CELL|0)+dy]===T.FLOOR)hall++;
      if(hall<3)return -Infinity;
      return -Math.abs(e-15)*.5+Math.random()*3;
    });
    if(!ok)return false;
    const t=this.path[this.path.length-1];this.pos.set((t/w.n|0)*CFG.CELL,0,(t%w.n)*CFG.CELL);this.lastGoo.copy(this.pos);
    this.mode='lure';this.lureT=rnd(10,16);this.path.length=0;this.travelling=false;this.peeking=false;this.lingerT=1;this.speed=0;return true;
  }
  // ---- back-stalk: silently route directly behind the player, THUD ----
  enterBackStalk(){
    const g=this.g,c=g.camera.position,w=g.world;
    g.camera.getWorldDirection(FWD);
    const dest=V3.set(FWD.x*-1.9,0,FWD.z*-1.9);
    const tx=c.x+dest.x,tz=c.z+dest.z;
    const cell=w.cell(tx,tz);if(cell.x<0||cell.x>=w.n||cell.y<0||cell.y>=w.n)return;
    if(w.grid[cell.x][cell.y]!==T.FLOOR||w.los(c.x,c.z,tx,tz))return;
    const was=this.pos.clone();
    this.pos.set(tx,0,tz);this.lastGoo.copy(was);
    this.mode='backStalk';this.pathT=1.1;this.spinT=0;this.peeking=false;this.lingerT=0;this.seenT=0;this.litT=0;
    this.dir.set(c.x-this.pos.x,0,c.z-this.pos.z).normalize();
    this.travelling=false;this.path.length=0;
    g.audio.thud(c,true);
  }

  /* ---------- phase 1: phantom stalker ---------- */
  findStalkSpot(){
    const c=this.g.camera.position,w=this.g.world,D=this.distMap;
    return this.search(60,(id,depth,X,Z)=>{
      const pd=D[id];if(pd<4||pd>9)return -Infinity;
      const ex=X-c.x,ez=Z-c.z,e=Math.hypot(ex,ez);if(e<14||w.los(c.x,c.z,X,Z))return -Infinity;
      let s=-Math.abs(pd-6)*3-depth*.6+Math.random()*4;
      if((ex*FWD.x+ez*FWD.z)/e<-.2)s+=6;
      return s;
    },3);
  }

  // occasionally ease into a long sightline beyond the fog and just... stand there
  findPeek(){
    const c=this.g.camera.position,w=this.g.world;
    return this.search(30,(id,depth,X,Z)=>{
      const e=Math.hypot(X-c.x,Z-c.z);if(e<20||e>30||!w.los(c.x,c.z,X,Z))return -Infinity;
      return -depth+Math.random()*3;
    },3);
  }

  stalk(dt){
    const g=this.g;this.peekCD-=dt;
    if(this.travelling&&!this.path.length){this.travelling=false;this.lingerT=this.peeking?rnd(3,6):rnd(.8,3);this.lingerAcc=0;this.pooled=false}
    if(this.lingerT>0){
      this.lingerT-=dt;this.lingerAcc+=dt;
      if(!this.pooled&&this.lingerAcc>1.3){this.pooled=true;g.goo.pool(this.pos.x,this.pos.z,.8)}
      if(this.lingerT>0)return;
      this.peeking=false;
    }
    if(this.travelling&&!this.peeking&&(this.pathT-=dt)>0)return;
    if(this.travelling&&this.peeking)return;
    this.pathT=rnd(1.2,1.8);
    if(this.peekCD<=0&&this.findPeek()){this.peeking=true;this.peekCD=rnd(18,32)}
    else{this.peeking=false;this.findStalkSpot()}
    this.travelling=this.path.length>0;
    if(!this.travelling){this.lingerT=rnd(1,2);this.lingerAcc=0;this.pooled=true}
  }

  /* ---------- locomotion ---------- */
  stepBy(dx,dz){
    const w=this.g.world,p=this.pos,l=Math.hypot(dx,dz);if(l<1e-5)return;
    if(!w.collides(p.x+dx,p.z,.2))p.x+=dx;if(!w.collides(p.x,p.z+dz,.2))p.z+=dz;
    this.dir.x+=(dx/l-this.dir.x)*.25;this.dir.z+=(dz/l-this.dir.z)*.25;this.dir.normalize();
  }
  move(dt,speed){
    if(!this.path.length||speed<=0)return;
    const w=this.g.world,id=this.path[0],tx=(id/w.n|0)*CFG.CELL,tz=(id%w.n)*CFG.CELL;
    const dx=tx-this.pos.x,dz=tz-this.pos.z,d=Math.hypot(dx,dz);
    if(d<.25){
      this.path.shift();
      // larger pooled slicks where it slinks around corners
      if(this.path.length&&this.mode==='stalk'){
        const nid=this.path[0],nx=(nid/w.n|0)*CFG.CELL-tx,nz=(nid%w.n)*CFG.CELL-tz,nl=Math.hypot(nx,nz)||1;
        if((nx*this.dir.x+nz*this.dir.z)/nl<.5&&Math.random()<.45)this.g.goo.pool(this.pos.x,this.pos.z,.55);
      }
      return;
    }
    const s=Math.min(d,speed*dt)/d;this.stepBy(dx*s,dz*s);
  }
  chaseDirect(dt,speed){
    const c=this.g.camera.position,dx=c.x-this.pos.x,dz=c.z-this.pos.z,d=Math.hypot(dx,dz)||1,s=Math.min(d,speed*dt)/d;
    this.stepBy(dx*s,dz*s);
  }

  /* ---------- per-frame ---------- */
    update(dt){
    const g=this.g,a=g.audio;
    if(!this.active){$('danger').style.opacity=0;if((this.respawn-=dt)<=0)this.spawn();return}
    if((g.camCD-=dt)<0)g.camCD=0;
    const c=g.camera.position,w=g.world,d=this.dist();
    if(this.freeze>0){this.freeze-=dt;this.speed=0;this.animate(dt,true,d);if(this.freeze<=0)this.enterDart();return}
    if(this.blood>0){this.blood=Math.max(0,this.blood-dt);if(!this.path.length&&d>1.2){const pc=w.cell(c.x,c.z);this.flood(pc.x,pc.y);this.search(30,id=>-Math.max(0,this.distMap[id])*10)}}
    // dark: the body is gone, the eyes sprint at you
    if(this.mode==='bloodlust'){
      const speed=6.4; // faster than the player's 5.4 run
      if(g.world.los(c.x,c.z,this.pos.x,this.pos.z))this.chaseDirect(dt,speed);
      else{if((this.pathT-=dt)<=0){this.pathT=.15;
        const pc=w.cell(c.x,c.z);this.flood(pc.x,pc.y);this.search(40,id=>-Math.max(0,this.distMap[id])*10)}this.move(dt,speed)}
      this.speed+=(speed-this.speed)*Math.min(1,dt*8);
      this.animate(dt,false,d,true);
      $('danger').style.opacity=clamp((14-d)/12,0,1).toFixed(2);
      if(d<1.1)g.killPlayer();return;
    }
    const pc=w.cell(c.x,c.z);
    if((this.floodT-=dt)<=0||pc.x!==this.pcx||pc.y!==this.pcy){this.flood(pc.x,pc.y);this.pcx=pc.x;this.pcy=pc.y;this.floodT=.5}
    g.camera.getWorldDirection(FWD);
    const mc=w.cell(this.pos.x,this.pos.z),pathD=this.distMap[mc.x*w.n+mc.y];

    // perception
    V1.set(this.pos.x,2.2,this.pos.z);let lit=g.flash.hits(V1);if(!lit){V1.y=1.2;lit=g.flash.hits(V1)}
    const los=w.los(c.x,c.z,this.pos.x,this.pos.z);
    V3.set(this.pos.x-c.x,0,this.pos.z-c.z).normalize();
    const facing=V3.x*FWD.x+V3.z*FWD.z,inView=los&&facing>.8;
    if(lit)this.litT+=dt;else this.litT=Math.max(0,this.litT-dt*2);
    if(inView&&!lit)this.seenT+=dt;else this.seenT=Math.max(0,this.seenT-dt);
    this.dartCD-=dt;

    // dead end check: player's cell has one exit and it's in the way
    const trapped=this.openCount(pc.x,pc.y)<=1&&pathD>=0&&pathD<=3;
    // straight-line walk -> the THUD behind you
    const straightYaw=g.player.moving?g.camera.rotation.y:this.lastYaw;
    const dYaw=Math.abs(Math.atan2(Math.sin(straightYaw-this.lastYaw),Math.cos(straightYaw-this.lastYaw)));
    if(g.player.moving&&dYaw<.18){this.straightT+=dt;this.straightLen+=(g.player.running?.54:.30)*dt}
    else if(!g.player.moving)this.straightT=Math.max(0,this.straightT-dt*2);
    else{this.straightT=Math.max(0,this.straightT-dt);this.straightLen=this.straightLen*.7}
    if(!g.player.moving)this.straightLen*=Math.pow(.5,dt);
    this.lastYaw=straightYaw;
    const bump=Math.random()<dt*.04; // luring chance
    if(this.straightLen>4.5&&!g.dark&&g.player.controls.isLocked&&d>3&&this.mode==='stalk'){this.enterBackStalk();this.straightLen=0;this.straightT=0}
    else if(bump&&this.mode==='stalk'&&!this.peeking&&d>6&&this.peekCD>0){this.enterLure()}

    // ---- phase logic ----
    let speed=0;
    if(this.mode==='lure'){
      this.lureT-=dt;
      if(d<12&&los){ // player took the bait: vanish around a corner with a slick
        this.g.goo.trail(this.pos.x,this.pos.z,this.dir.x,this.dir.z,clamp(.6,0,1));
        this.g.goo.pool(this.pos.x,this.pos.z,.9);this.enterRetreat(false);
      }else if(this.lureT<=0){this.enterStalk(rnd(1,2))}
    }else if(this.mode==='backStalk'){
      const behindT=(this.pathT-=dt);
      if(behindT>0){
        // planted behind the player, waiting for the spin
        if(inView) this.spinT+=dt; else this.spinT=0;
        if(this.spinT>.15){ // they looked
          this.g.goo.pool(this.pos.x,this.pos.z,1);this.enterDart();
        }
      }else if(!this.path.length){this.g.goo.pool(this.pos.x,this.pos.z,.6);this.enterRetreat(false)}
      else{ speed=7;this.move(dt,speed) }
    }else if(this.mode==='strike'){
      if(g.dark){this.enterBloodlust();return}
      if(lit&&this.litT>.9&&d>2.5){this.enterRetreat(true)}
      else{
        if(!los&&d>6)this.lostT+=dt;else this.lostT=0;
        if(this.lostT>3.5||d>22)this.enterStalk(rnd(1,2));
        else{
          speed=9.5;
          if(los&&d<6)this.chaseDirect(dt,speed);
          else{if((this.pathT-=dt)<=0){this.pathT=.2;this.search(40,id=>-Math.max(0,this.distMap[id])*10)}this.move(dt,speed)}
        }
      }
    }else if(lit&&d>=6&&this.mode!=='retreat'){
      this.enterRetreat(true);
    }else if(this.mode==='retreat'?d<1.8:((d<5.5&&los)||(d<2.4)||(trapped&&d<12&&los))){
      this.enterStrike();
    }else if(this.mode==='retreat'){
      this.agonyT-=dt;
      if(this.agonyT>0)speed=0;else{speed=15;this.move(dt,speed)}
      if(this.agonyT<=0&&!this.path.length)this.enterStalk(rnd(3,6));
    }else if(this.mode==='dart'){
      speed=24;this.move(dt,speed);
      if(!this.path.length)this.enterStalk(rnd(2,4));
    }else{
      // stalk
      if(inView&&d>9&&this.seenT>(this.peeking?.6:.25)&&this.dartCD<=0)this.enterDart();
      else if(inView&&d>9&&this.seenT>1.6)this.enterRetreat(false);
      else{
        this.stalk(dt);
        if(this.travelling){speed=this.peeking?1.1:(los?1.4:2.8);this.move(dt,speed)}
      }
    }
    this.speed+=(speed-this.speed)*Math.min(1,dt*8);

    // goo trail behind it
    const moved=this.lastGoo.distanceTo(this.pos);
    if(moved>(this.speed>10?1.6:.9)){
      g.goo.trail(this.pos.x,this.pos.z,this.dir.x,this.dir.z,clamp(this.speed/12,0,1.5));
      this.lastGoo.copy(this.pos);
    }

    // audio cues (stealthy during stalk)
    if(this.mode==='strike'&&Math.random()<dt*3.5)a.monsterStep(this.pos,d);
    if(this.mode==='stalk'&&d<16&&Math.random()<dt*.02)a.whisper(this.pos,d);

    this.animate(dt,lit,d);

    const danger=this.mode==='strike'?clamp((14-d)/12,0,1)*.85:0;
    $('danger').style.opacity=danger.toFixed(2);
    if(this.mode==='strike'&&d<1.1)g.killPlayer();
  }

  animate(dt,lit,d,eyesOnly=false){
    const g=this.g,c=g.camera.position;this.t+=dt;
    const m=this.mode,agony=m==='retreat'&&this.agonyT>0,fast=this.speed>8;
    // face movement, or the player when still
    const yaw=this.speed>.5?Math.atan2(this.dir.x,this.dir.z):Math.atan2(c.x-this.pos.x,c.z-this.pos.z);
    let dy=yaw-this.group.rotation.y;dy=Math.atan2(Math.sin(dy),Math.cos(dy));this.group.rotation.y+=dy*Math.min(1,dt*(fast?12:3));

    // shader warp: slow liquid sway at rest, violent shudder in agony / strike
    this.U.uTime.value=this.t;
    this.U.uWarp.value+=((m==='strike'?2.2:fast?1.6:1)-this.U.uWarp.value)*Math.min(1,dt*4);
    this.U.uShudder.value+=((agony?3:lit?1.6:m==='strike'?.8:0)-this.U.uShudder.value)*Math.min(1,dt*10);

    // body posture: hunched forward lunge when sprinting, elongated stretch while lingering
    const lean=fast?.42:m==='strike'?.3:0;
    this.body.rotation.x+=(lean-this.body.rotation.x)*Math.min(1,dt*6);
    const stretch=1+.06*Math.sin(this.t*.53)+(this.lingerT>0?.08:0);
    this.body.scale.set(1/Math.sqrt(stretch),stretch,1/Math.sqrt(stretch));
    if(agony){this.body.position.set(rnd(-.09,.09),rnd(-.03,.03),rnd(-.09,.09));this.body.rotation.z=rnd(-.12,.12)}
    else{this.body.position.multiplyScalar(.8);this.body.rotation.z=Math.sin(this.t*.8)*.04}

    // visibility: always a near-silhouette; vanishes into the fog when far / stalking
    let vis=m==='strike'?1:m==='bloodlust'?0:m==='backStalk'?1:m==='dart'?.85:agony?1:m==='lure'?1:m==='retreat'?.75:this.peeking?.7:.55;
    vis*=clamp((36-d)/14,0,1);
    const flick=fast?(Math.random()<.35?.35:1):1;
    this.bodyMat.opacity=this.limbMat.opacity=vis*flick*.96;

    // smoke shroud: billboard puffs that rise, swell and dissipate, streaming behind when fast
    for(const s of this.puffs){
      const u=s.userData;u.life+=dt/u.dur;
      if(u.life>=1){u.life-=1;u.a=rnd(0,Math.PI*2);u.r=rnd(.05,.55);u.y0=rnd(0,2.6)}
      const L=u.life,trail=fast?L*1.4:0;
      s.position.set(Math.cos(u.a)*u.r*(1+L*.6),u.y0+L*u.rise,Math.sin(u.a)*u.r*(1+L*.6)-trail);
      s.scale.setScalar(u.size*(.6+L*.9)*(m==='strike'?1.3:1));
      s.material.rotation+=u.spin*dt;
      s.material.opacity=Math.sin(L*Math.PI)*.62*vis;
    }

    // eyes: pinpoint embers that flare in the beam, faintly peer when lingering
    V2.set(c.x-this.pos.x,0,c.z-this.pos.z).normalize();
    const facing=V2.x*Math.sin(this.group.rotation.y)+V2.z*Math.cos(this.group.rotation.y);
    let eye=0;
    if(eyesOnly)eye=.95+Math.random()*.05;
    else if(lit)eye=.85+Math.random()*.15;
    else if(m==='strike')eye=.7+Math.random()*.3;
    else if((this.lingerT>0||this.peeking)&&facing>.3)eye=.22+.08*Math.sin(this.t*3.1);
    if(Math.sin(this.t*.9)>.985)eye*=.1; // blink
    this.eyeMat.opacity+=(eye*clamp((40-d)/18,0,1)-this.eyeMat.opacity)*Math.min(1,dt*(lit?20:5));
    const es=.12+(lit?.12:0)+d*.006;for(const e of this.eyes)e.scale.setScalar(es);
  }
}

class Audio{
  constructor(g){this.g=g;this.ctx=null;this.stepT=0;this.R=new THREE.Vector3();this.F=new THREE.Vector3();this.ir={};this.roomAmt=.3;this.powerOut=false}
  init(){
    if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return}
    const x=this.ctx=new(window.AudioContext||window.webkitAudioContext)(),now=x.currentTime;
    this.master=x.createGain();this.master.gain.value=0;this.master.connect(x.destination);this.master.gain.linearRampToValueAtTime(.9,now+3);
    const filt=x.createBiquadFilter();filt.type='lowpass';filt.frequency.value=240;filt.Q.value=6;
    this.hum=x.createGain();this.hum.gain.value=.11;filt.connect(this.hum);this.hum.connect(this.master);
    const lfo=x.createOscillator();lfo.frequency.value=.13;const lg=x.createGain();lg.gain.value=70;lfo.connect(lg);lg.connect(filt.frequency);lfo.start();
    [55,110,220.5].forEach((f,i)=>{const o=x.createOscillator();o.type=i?'triangle':'sawtooth';o.frequency.value=f;o.detune.value=(i-1)*6;const gg=x.createGain();gg.gain.value=.5/(i+1);o.connect(gg);gg.connect(filt);o.start()});
    const b=x.createOscillator();b.type='square';b.frequency.value=120;this.buzz=x.createGain();this.buzz.gain.value=.012;b.connect(this.buzz);this.buzz.connect(this.master);b.start();
    // room/hall reverb bus: dry -> master, wet convolver -> master
    this.verbGain=x.createGain();this.verbGain.gain.value=1;this.verbGain.connect(this.master);
    this.verb=x.createConvolver();this.verbSend=x.createGain();this.verbSend.gain.value=.5;
    this.verb.connect(this.verbSend);this.verbSend.connect(this.master);
    this.ir.hall=this.impulse(2.6,3.2);this.ir.room=this.impulse(1.1,5.2);this.verb.buffer=this.ir.hall;
    const len=x.sampleRate*.5|0;this.noise=x.createBuffer(1,len,x.sampleRate);const d=this.noise.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
    const sl=x.sampleRate*.18|0;this.stepBuf=x.createBuffer(1,sl,x.sampleRate);const s=this.stepBuf.getChannelData(0);for(let i=0;i<sl;i++)s[i]=(Math.random()*2-1)*Math.pow(1-i/sl,3);
  }
  impulse(T,decay){
    const x=this.ctx,N=x.sampleRate*T|0,b=x.createBuffer(2,N,x.sampleRate);
    for(let c=0;c<2;c++){const d=b.getChannelData(c);for(let i=0;i<N;i++)d[i]=((Math.random()*2-1)*Math.pow(1-i/N,decay)*.6);for(let i=0;i<Math.min(80,N);i++)d[i]=Math.random()*2-1;}
    return b;
  }
  routeGain(node,useReverb,reverbGain=.4){
    if(!useReverb||this.powerOut){node.connect(this.master);return}
    node.connect(this.master);
    const tap=this.ctx.createGain();tap.gain.value=reverbGain;node.connect(tap);tap.connect(this.verb);
  }
  spatial(node,pos,gain,dist){
    const x=this.ctx,c=this.g.camera;c.getWorldDirection(this.F);this.R.set(-this.F.z,0,this.F.x).normalize();
    const dx=pos.x-c.position.x,dz=pos.z-c.position.z,d=dist??Math.hypot(dx,dz),inv=1/Math.max(d,.001);
    const pan=clamp((dx*this.R.x+dz*this.R.z)*inv,-1,1)*.9,front=(dx*this.F.x+dz*this.F.z)*inv;
    const lp=x.createBiquadFilter();lp.type='lowpass';lp.frequency.value=clamp(2400/(1+d*.25),180,2400)*(front<-.3?.6:1);
    const gn=x.createGain();gn.gain.value=gain/(1+d*d*.02);const p=x.createStereoPanner();p.pan.value=pan;
    node.connect(lp);lp.connect(gn);gn.connect(p);this.routeGain(p,!this.powerOut,clamp(this.roomAmt,.1,.6));
  }
  tone(f,dur,gain=.05,type='sine',pos=null){
    if(!this.ctx)return null;
    const x=this.ctx,t=x.currentTime,o=x.createOscillator(),g=x.createGain();o.type=type;o.frequency.setValueAtTime(f,t);
    g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);pos?this.spatial(g,pos,1):this.routeGain(g,!this.powerOut,.25);
    o.start(t);o.stop(t+dur+.05);return o;
  }
  click(){this.tone(950,.035,.03,'square')}
  windTick(){if(!this.ctx)return;const t=this.ctx.currentTime;if(t-(this.lastWind||0)<.15)return;this.lastWind=t;this.tone(rnd(300,400),.05,.02,'square')}
  footstep(){
    if(!this.ctx||this.powerOut&&false)return;
    const x=this.ctx,t=x.currentTime,s=x.createBufferSource(),f=x.createBiquadFilter(),g=x.createGain();
    s.buffer=this.stepBuf;s.playbackRate.value=rnd(.85,1.15); // pitch variation
    f.type='lowpass';f.frequency.value=rnd(650,950);
    g.gain.setValueAtTime(rnd(.2,.3),t); // volume variation
    g.gain.exponentialRampToValueAtTime(.0001,t+.2);
    s.connect(f);f.connect(g);this.routeGain(g,!this.powerOut,clamp(this.roomAmt,.1,.55));s.start(t);s.stop(t+.22);
  }
  monsterStep(pos,d){if(!this.ctx)return;const x=this.ctx,s=x.createBufferSource();s.buffer=this.stepBuf;s.playbackRate.value=rnd(.5,.75);this.spatial(s,pos,.9,d);s.start();const t=x.currentTime,o=x.createOscillator(),g=x.createGain();o.frequency.setValueAtTime(rnd(48,62),t);o.frequency.exponentialRampToValueAtTime(30,t+.2);g.gain.setValueAtTime(.35,t);g.gain.exponentialRampToValueAtTime(.0001,t+.25);o.connect(g);this.spatial(g,pos,1,d);o.start(t);o.stop(t+.3)}
  whisper(pos,d){if(!this.ctx)return;const x=this.ctx,t=x.currentTime,s=x.createBufferSource(),bp=x.createBiquadFilter(),g=x.createGain(),dur=rnd(.9,1.8);s.buffer=this.noise;s.loop=true;bp.type='bandpass';bp.frequency.setValueAtTime(rnd(500,900),t);bp.frequency.linearRampToValueAtTime(rnd(1200,2000),t+dur);bp.Q.value=4;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.18,t+dur*.4);g.gain.linearRampToValueAtTime(0,t+dur);s.connect(bp);bp.connect(g);this.spatial(g,pos,1,d);s.start(t);s.stop(t+dur+.05)}
  shriek(pos){if(!this.ctx)return;const o=this.tone(rnd(170,230),.6,.12,'sawtooth',pos);if(o)o.frequency.exponentialRampToValueAtTime(60,this.ctx.currentTime+.6)}
  screech(pos){
    if(!this.ctx)return;const x=this.ctx,t=x.currentTime;
    for(const f of[rnd(900,1200),rnd(1300,1700)]){const o=this.tone(f,.75,.07,'sawtooth',pos);if(o){o.frequency.linearRampToValueAtTime(f*.55,t+.7);const l=x.createOscillator(),lg=x.createGain();l.frequency.value=rnd(28,40);lg.gain.value=f*.08;l.connect(lg);lg.connect(o.frequency);l.start(t);l.stop(t+.8)}}
    const s=x.createBufferSource(),bp=x.createBiquadFilter(),g=x.createGain();s.buffer=this.noise;bp.type='bandpass';bp.frequency.value=2600;bp.Q.value=2;g.gain.setValueAtTime(.3,t);g.gain.exponentialRampToValueAtTime(.0001,t+.6);s.connect(bp);bp.connect(g);this.spatial(g,pos,1);s.start(t);s.stop(t+.65);
  }
  roar(pos){
    if(!this.ctx)return;const x=this.ctx,t=x.currentTime;
    const o=this.tone(rnd(85,110),1.3,.22,'sawtooth',pos);if(o){o.frequency.setValueAtTime(rnd(140,170),t+.08);o.frequency.exponentialRampToValueAtTime(38,t+1.25)}
    this.tone(rnd(55,62),1.3,.2,'square',pos);
    const s=x.createBufferSource(),lp=x.createBiquadFilter(),g=x.createGain();s.buffer=this.noise;s.loop=true;lp.type='lowpass';lp.frequency.setValueAtTime(1400,t);lp.frequency.exponentialRampToValueAtTime(200,t+1.2);g.gain.setValueAtTime(.45,t);g.gain.exponentialRampToValueAtTime(.0001,t+1.25);s.connect(lp);lp.connect(g);this.spatial(g,pos,1);s.start(t);s.stop(t+1.3);
  }
  whoosh(pos){
    if(!this.ctx)return;const x=this.ctx,t=x.currentTime,s=x.createBufferSource(),bp=x.createBiquadFilter(),g=x.createGain();
    s.buffer=this.noise;s.loop=true;bp.type='bandpass';bp.Q.value=1.2;bp.frequency.setValueAtTime(300,t);bp.frequency.exponentialRampToValueAtTime(1800,t+.25);bp.frequency.exponentialRampToValueAtTime(400,t+.5);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.35,t+.15);g.gain.exponentialRampToValueAtTime(.0001,t+.55);s.connect(bp);bp.connect(g);this.spatial(g,pos,1);s.start(t);s.stop(t+.6);
  }
  pop(pos){if(!this.ctx)return;const x=this.ctx,s=x.createBufferSource(),g=x.createGain(),t=x.currentTime;s.buffer=this.noise;g.gain.setValueAtTime(.5,t);g.gain.exponentialRampToValueAtTime(.0001,t+.12);s.connect(g);this.spatial(g,pos,1);s.start(t);s.stop(t+.15)}
  distant(){if(!this.ctx)return;const a=rnd(0,Math.PI*2),c=this.g.camera.position;V3.set(c.x+Math.cos(a)*30,0,c.z+Math.sin(a)*30);Math.random()<.5?this.monsterStep(V3,30):this.tone(rnd(70,110),1.4,.06,'triangle',V3)}
  setStress(s){if(!this.ctx)return;this.buzz.gain.setTargetAtTime(.012+s*.05,this.ctx.currentTime,.1)}
  silence(on){if(!this.ctx)return;this.master.gain.cancelScheduledValues(this.ctx.currentTime);this.master.gain.setTargetAtTime(on?0:.9,this.ctx.currentTime,on?.05:.8)}
  update(dt){
    if(!this.ctx)return;
    const p=this.g.player;this.stepT-=dt;
    if(p.moving&&this.stepT<=0){this.footstep();this.stepT=(p.running?.34:.5)*rnd(.85,1.2)}
    if(!p.moving)this.stepT=Math.min(this.stepT,.05);
    // corridor = narrow/muffled, open room = long wet reverb
    const w=this.g.world,c=this.g.world.cell(this.g.camera.position.x,this.g.camera.position.z);
    let open=0;for(let x=c.x-3;x<=c.x+3;x++)for(let y=c.y-3;y<=c.y+3;y++)if(w.grid[x]?.[y]===T.FLOOR)open++;
    const target=open>34?.75:open>22?.45:.12;
    this.roomAmt+=(target-this.roomAmt)*Math.min(1,dt*2);
    if(this.powerOut)return;
    this.verb.buffer=open>22?this.ir.room:this.ir.hall;
    this.verbSend.gain.value=open>22?.8:.28;
  }
  // floodlamps dying: pitch-down whine + clunk + everything cuts out
  powerDown(){
    if(!this.ctx)return;this.powerOut=true;const x=this.ctx,t=x.currentTime;
    const o=x.createOscillator(),g=x.createGain();o.type='sawtooth';o.frequency.setValueAtTime(420,t);o.frequency.exponentialRampToValueAtTime(28,t+.9);
    g.gain.setValueAtTime(.28,t);g.gain.exponentialRampToValueAtTime(.0001,t+1);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+1.05);
    const s=x.createBufferSource(),lp=x.createBiquadFilter(),sg=x.createGain();s.buffer=this.noise;lp.type='lowpass';lp.frequency.setValueAtTime(2200,t);lp.frequency.exponentialRampToValueAtTime(60,t+1.2);sg.gain.setValueAtTime(.5,t);sg.gain.exponentialRampToValueAtTime(.0001,t+1.3);s.connect(lp);lp.connect(sg);sg.connect(this.master);s.start(t);s.stop(t+1.35);
    this.tone(48,.35,.4,'square');
    for(const node of[this.hum,this.buzz]){node.gain.cancelScheduledValues(t);node.gain.setTargetAtTime(0,t,.05)}
    this.verbSend.gain.setTargetAtTime(0,t,.05);
  }
  restore(){if(!this.ctx)return;this.powerOut=false;const t=this.ctx.currentTime;this.master.gain.setTargetAtTime(.9,t,.2);this.hum.gain.setTargetAtTime(.11,t,.2);this.buzz.gain.setTargetAtTime(.012,t,.2);this.verbSend.gain.setTargetAtTime(.3,t,.2)}
  // the kill: distorted high shriek + sub-drop, clipping, then silence
  killScream(){
    if(!this.ctx)return;const x=this.ctx,t=x.currentTime;
    const bus=x.createGain();bus.gain.value=.9;const ws=x.createWaveShaper();ws.curve=this.clipCurve();ws.oversample='4x';
    bus.connect(ws);ws.connect(this.master);
    const sub=x.createOscillator(),sg=x.createGain();sub.type='sine';sub.frequency.setValueAtTime(150,t);sub.frequency.exponentialRampToValueAtTime(20,t+1.1);
    sg.gain.setValueAtTime(0,t);sg.gain.linearRampToValueAtTime(1.4,t+.04);sg.gain.setValueAtTime(1.4,t+.5);sg.gain.exponentialRampToValueAtTime(.0001,t+1.5);sub.connect(sg);sg.connect(bus);sub.start(t);sub.stop(t+1.55);
    const sub2=x.createOscillator(),sg2=x.createGain();sub2.type='triangle';sub2.frequency.setValueAtTime(74,t);sub2.frequency.exponentialRampToValueAtTime(19,t+1.1);sg2.gain.setValueAtTime(.9,t);sg2.gain.exponentialRampToValueAtTime(.0001,t+1.5);sub2.connect(sg2);sg2.connect(bus);sub2.start(t);sub2.stop(t+1.55);
    for(const f of[2400,3100,4200,5300]){const o=x.createOscillator(),og=x.createGain();o.type='sawtooth';o.frequency.setValueAtTime(f*rnd(.97,1.03),t);o.frequency.exponentialRampToValueAtTime(f*.45,t+1.1);og.gain.setValueAtTime(.16,t);og.gain.setValueAtTime(.2,t+.35);og.gain.exponentialRampToValueAtTime(.0001,t+1.4);o.connect(og);og.connect(bus);o.start(t);o.stop(t+1.45)}
    const n=x.createBufferSource(),nb=x.createBiquadFilter(),ng=x.createGain();n.buffer=this.noise;n.loop=true;nb.type='bandpass';nb.frequency.value=5200;nb.Q.value=.8;ng.gain.setValueAtTime(.3,t);ng.gain.exponentialRampToValueAtTime(.0001,t+1.2);n.connect(nb);nb.connect(ng);ng.connect(bus);n.start(t);n.stop(t+1.25);
    this.silence(true);setTimeout(()=>{for(const nd of[bus,ws,sg,sg2,ng])try{nd.disconnect()}catch(e){}},1700);
  }
  clipCurve(){const N=2048,c=new Float32Array(N);for(let i=0;i<N;i++){const v=i/(N-1)*2-1;c[i]=Math.tanh(v*4.5)}return c}
  shutter(){
    if(!this.ctx)return;const x=this.ctx,t=x.currentTime;
    const s=x.createBufferSource(),bp=x.createBiquadFilter(),g=x.createGain();s.buffer=this.noise;bp.type='bandpass';bp.frequency.setValueAtTime(4200,t);bp.frequency.exponentialRampToValueAtTime(900,t+.09);bp.Q.value=1.5;g.gain.setValueAtTime(.55,t);g.gain.exponentialRampToValueAtTime(.0001,t+.12);s.connect(bp);bp.connect(g);g.connect(this.master);s.start(t);s.stop(t+.14);
    this.tone(2200,.05,.18,'square');this.tone(340,.14,.12,'square');this.tone(90,.22,.1,'sine');
  }
  hiss(pos){
    if(!this.ctx)return;const x=this.ctx,t=x.currentTime,dur=rnd(.4,.9);
    const s=x.createBufferSource(),hp=x.createBiquadFilter(),g=x.createGain();s.buffer=this.noise;s.loop=true;hp.type='highpass';hp.frequency.setValueAtTime(3000,t);hp.frequency.exponentialRampToValueAtTime(700,t+dur);
    g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.22,t+.05);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(hp);hp.connect(g);this.spatial(g,pos,1);s.start(t);s.stop(t+dur+.05);
    const o=this.tone(rnd(1900,2600),dur,.09,'square',pos);if(o)o.frequency.exponentialRampToValueAtTime(rnd(200,400),t+dur);
  }
  thud(pos,near=true){
    if(!this.ctx)return;const x=this.ctx,t=x.currentTime;
    const o=x.createOscillator(),g=x.createGain();o.type='sine';o.frequency.setValueAtTime(near?88:70,t);o.frequency.exponentialRampToValueAtTime(26,t+.22);
    g.gain.setValueAtTime(near?.75:.5,t);g.gain.exponentialRampToValueAtTime(.0001,t+.32);o.connect(g);
    if(near)g.connect(this.master);else this.spatial(g,pos,1,2);
    o.start(t);o.stop(t+.35);
    const s=x.createBufferSource(),lp=x.createBiquadFilter(),sg=x.createGain();s.buffer=this.stepBuf;lp.type='lowpass';lp.frequency.value=420;sg.gain.setValueAtTime(.4,t);sg.gain.exponentialRampToValueAtTime(.0001,t+.16);s.connect(lp);lp.connect(sg);if(near)sg.connect(this.master);else this.spatial(sg,pos,1,2);s.start(t);s.stop(t+.18);
  }
  jumpIntro(){this.tone(60,.5,.3,'sine');this.tone(1200,.1,.08,'sawtooth')}
}

class Game{
  constructor(){
    this.renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));this.renderer.setSize(innerWidth,innerHeight);this.renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.prepend(this.renderer.domElement);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(CFG.FOG[0]);this.scene.fog=new THREE.Fog(...CFG.FOG);
    this.camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.05,90);this.scene.add(this.camera);
    buildMaterials();
    this.level=-1;this.dead=false;this.dark=false;this.camCD=0;this.sayT=0;this.recT=0;this.distT=rnd(20,40);this.trackY=-10;
    this.goo=new GooTrail(this.scene);this.audio=new Audio(this);this.lighting=new Lighting(this.scene);this.player=new Player(this);this.flash=new Flashlight(this);this.monster=new Monster(this);
    this.newLevel();
    const start=$('start'),c=this.player.controls;
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      start.style.display = 'none';
      const startMobile = () => {
        this.audio.init();
        c.isLocked = true;
        document.removeEventListener('touchstart', startMobile);
      };
      document.addEventListener('touchstart', startMobile);
    } else {
      start.addEventListener('click', () => { this.audio.init(); c.lock(); });
    }
    c.addEventListener('lock',()=>start.classList.add('hidden'));c.addEventListener('unlock',()=>{if(!this.dead)start.classList.remove('hidden')});
    this.coords=$('coords');this.status=$('status');this.clockEl=$('clock');this.track=$('track');
    addEventListener('resize',()=>this.resize());this.clock=new THREE.Clock();this.acc=0;this.renderer.setAnimationLoop(()=>this.loop());
    $('fullscreen-btn')?.addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    });
  }
  newLevel(){
    this.level++;this.world?.dispose();this.goo.clear();
    const data=new Maze(CFG.SIZE).generate();this.world=new World(this.scene,data);this.lighting.setWorld(this.world);this.monster.reset();
    this.camera.position.set(data.spawn.x*CFG.CELL,CFG.EYE,data.spawn.y*CFG.CELL);this.flash.battery=Math.max(this.flash.battery,.6);
    this.dark=false;this.camCD=0;this.flash.on=true;this.audio.restore();$('dark').style.opacity=0;
    this.lighting.setDark(false);this.scene.background.set(CFG.FOG[0]);this.scene.fog.color.set(CFG.FOG[0]);
    $('level').textContent=this.level;$('danger').style.opacity=0;this.say(this.level?'THE LEVEL CHANGED.':'NO SIGNAL.');
  }
  say(t,ms=1600){const m=$('msg');m.textContent=t;m.classList.add('show');clearTimeout(this.sayT);this.sayT=setTimeout(()=>m.classList.remove('show'),ms)}
  warn(t,ms){const w=$('warning');w.textContent=t;w.classList.add('show');clearTimeout(this.warnT);this.warnT=setTimeout(()=>w.classList.remove('show'),ms)}
  glitch(){const v=$('vhs');v.classList.remove('glitch');void v.offsetWidth;v.classList.add('glitch')}
  cameraBlast(){
    if(this.dead||this.camCD>0||this.dark||!this.player.controls.isLocked)return;this.camCD=2;
    this.audio.shutter();this.glitch();
    const f=$('flash');f.style.transition='none';f.style.opacity=1;requestAnimationFrame(()=>{f.style.transition='opacity .45s';f.style.opacity=0});
    this.monster.onFlash();
  }
  // battery at 0%: lights die, dynamo dies, eyes come for you
  blackout(){
    if(this.dark||this.dead)return;this.dark=true;
    this.audio.click();this.audio.powerDown();
    for(const l of this.lighting.pool)l.intensity=0;this.lighting.setDark(true);
    this.scene.background.set(0);this.scene.fog.color.set(0);
    this.flash.spot.intensity=0;this.flash.fill.intensity=0;
    $('dark').style.opacity=.35;
    this.warn('POWER FAILURE — RUN',2500);this.glitch();
    this.monster.enterBloodlust();
  }
  killPlayer(){
    if(this.dead)return;
    this.dead=true;this.player.controls.unlock();this.monster.active=false;this.monster.group.visible=false;
    const j=$('jumpscare');j.classList.remove('active');void j.offsetWidth;j.classList.add('active');
    this.audio.jumpIntro();this.audio.killScream();this.glitch();this.warn('YOU WERE FOUND',2000);
    setTimeout(()=>{j.classList.remove('active');this.dead=false;this.dark=false;this.newLevel();this.audio.restore();this.audio.silence(false);$('dark').style.opacity=0;$('start').classList.remove('hidden')},2000);
  }
  update(dt){
    if(this.dead)return;
    this.player.update(dt);this.flash.update(dt);this.monster.update(dt);this.lighting.update(dt,this.camera.position,this.monster);this.audio.update(dt);
    if(!this.dark)this.audio.setStress(this.lighting.maxStress);
    if(this.player.controls.isLocked&&(this.distT-=dt)<=0&&!this.dark){this.audio.distant();this.distT=rnd(25,60)}
  }
  hud(dt){
    this.recT+=dt;const s=this.recT|0;this.clockEl.textContent=[s/3600|0,(s/60|0)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');
    const c=this.world.cell(this.camera.position.x,this.camera.position.z);this.coords.textContent=String(c.x).padStart(3,'0')+','+String(c.y).padStart(3,'0');
    const m=this.monster,d=m.active?m.dist():99;
    // stalking is silent to the sensors; only overt actions register
    const detected=m.active&&m.mode==='strike';
    if(detected)this.status.textContent='AUDIO: MOVEMENT DETECTED';
    else if(m.active&&m.mode==='dart'&&d<30)this.status.textContent='AUDIO: SIGNAL DISTORTION';
    else if(m.active&&m.mode==='retreat'&&d<30)this.status.textContent='AUDIO: ELECTRICAL INTERFERENCE';
    else if(this.lighting.maxStress>.3)this.status.textContent='AUDIO: ELECTRICAL INTERFERENCE';
    else this.status.textContent='AUDIO: LOW HUM';
    this.trackY=(this.trackY+dt*(60+(detected?240:0)))%(innerHeight+20);this.track.style.transform=`translateY(${this.trackY}px)`;
  }
  loop(){const d=Math.min(this.clock.getDelta(),.1);this.acc=Math.min(this.acc+d,.25);while(this.acc>=CFG.STEP){this.update(CFG.STEP);this.acc-=CFG.STEP}this.hud(d);this.renderer.render(this.scene,this.camera)}
  resize(){this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight)}
}

window.game=new Game();
// A program generated by Ryual
