// GLSL ES 3.00 sources for the scene passes. The look is a cel-shaded anime style: banded lighting, hard rim
// light, coloured shadows, inverted-hull outlines, additive energy passes and a HDR framebuffer for bloom.

export const MAX_BONES = 48;
export const MAX_CRATERS = 24;
const FS_HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DShadow;
`;
const VS_HEAD = `#version 300 es
precision highp float; precision highp int;
`;

const NOISE = `
vec3 toLin(vec3 c){ return pow(max(c,vec3(0.)),vec3(2.2)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*noise2(p); p=p*2.03+vec2(17.,9.); a*=.5; } return s; }
`;

const LIGHT = `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmbSky; uniform vec3 uAmbGround;
uniform vec3 uRimCol; uniform vec3 uRimDir; uniform vec3 uFogCol; uniform float uFogDen; uniform vec3 uCamPos;
uniform vec4 uFlash[4]; uniform vec3 uFlashCol[4];
uniform sampler2DShadow uShadow; uniform mat4 uLightVP; uniform float uShadowTexel;
float shadowAt(vec3 wp, vec3 n){
  vec4 ls = uLightVP * vec4(wp + n*0.05, 1.0);
  vec3 c = ls.xyz/ls.w*0.5+0.5;
  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.||c.z>1.) return 1.;
  float s=0.;
  for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++) s += texture(uShadow, vec3(c.xy + vec2(float(i),float(j))*uShadowTexel, c.z - 0.0012));
  return s/9.;
}
vec3 applyFog(vec3 c, vec3 wp){
  float d = length(wp-uCamPos);
  float f = 1.-exp(-d*uFogDen);
  f *= exp(-max(wp.y,0.)*0.006);
  return mix(c, uFogCol, clamp(f,0.,0.94));
}
vec3 flashLight(vec3 col, vec3 N, vec3 wp){
  vec3 add = vec3(0.);
  for(int i=0;i<4;i++){
    vec3 d = uFlash[i].xyz - wp; float dist = length(d)+0.001;
    float a = uFlash[i].w / (1.+dist*dist*0.015);
    add += uFlashCol[i]*a*(0.35+0.65*max(dot(N,d/dist),0.));
  }
  return col*add;
}
// stepped anime lighting: lit band, coloured shadow band, thin highlight band and a hard rim light
vec3 toonR(vec3 col, vec3 N, vec3 V, vec3 wp, float sh, float rimAmt){
  float ndl = dot(N,uSunDir);
  float lit = smoothstep(-0.03,0.09,ndl) * mix(1.,sh,0.92);
  float hi  = smoothstep(0.62,0.68,ndl) * sh;
  vec3 amb = mix(uAmbGround,uAmbSky,N.y*0.5+0.5);
  vec3 shadowCol = col*(amb*0.9+vec3(0.02,0.02,0.04)+rimAmt*vec3(0.2,0.19,0.24));
  vec3 litCol = col*(uSunCol*0.72+amb*0.7);
  vec3 c = mix(shadowCol,litCol,lit) + col*uSunCol*0.10*hi;
  float ndv = clamp(dot(N,V),0.,1.);
  float rim = smoothstep(0.58,0.7,1.-ndv) * smoothstep(-0.15,0.45,dot(N,uRimDir));
  c += uRimCol*rim*(0.35+0.65*lit)*rimAmt;
  c += flashLight(col,N,wp);
  return c;
}
vec3 toon(vec3 col, vec3 N, vec3 V, vec3 wp, float sh){ return toonR(col,N,V,wp,sh,1.); }
`;

// ---------------------------------------------------------------- characters
export const CHAR_VS = VS_HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
layout(location=3) in vec2 aBone; layout(location=4) in vec2 aW; layout(location=5) in float aMat;
uniform mat4 uVP; uniform mat4 uBones[${MAX_BONES}]; uniform float uSkin; uniform float uOutline; uniform vec3 uCamPos;
out vec3 vN; out vec3 vColIn; out vec3 vW; out float vMat;
void main(){
  vec4 p = vec4(aPos,1.); vec3 n = aNrm;
  if(uSkin>0.5){
    mat4 m = uBones[int(aBone.x+0.5)]*aW.x + uBones[int(aBone.y+0.5)]*aW.y;
    p = m*p; n = mat3(m)*n;
  }
  n = normalize(n);
  if(uOutline>0. && aMat>2.5 && !(aMat>5.5 && aMat<6.5)){ gl_Position=vec4(2.,2.,2.,1.); vN=n; vColIn=aCol; vW=p.xyz; vMat=aMat; return; }
  float dist = length(p.xyz-uCamPos);
  p.xyz += n*uOutline*clamp(dist*0.16,0.7,3.2);
  vN=n; vColIn=aCol; vW=p.xyz; vMat=aMat;
  gl_Position = uVP*p;
}`;

export const CHAR_FS = FS_HEAD + NOISE + LIGHT + `
in vec3 vN; in vec3 vColIn; in vec3 vW; in float vMat;
uniform float uOutline; uniform vec4 uGhost; uniform vec3 uGlowCol; uniform float uHairGlow; uniform float uEyeGlow; uniform float uBodyGlow;
out vec4 o;
void main(){
  vec3 V = normalize(uCamPos - vW);
  vec3 N = normalize(vN);
  vec3 vCol = toLin(vColIn);
  if(uOutline>0.){ o = vec4(applyFog(vCol*0.16+vec3(0.004,0.004,0.01), vW),1.); return; }
  if(!gl_FrontFacing) N = -N;
  float ndv = clamp(dot(N,V),0.,1.);
  float rimG = pow(1.-ndv,2.2);
  if(uGhost.a>0.){ o = vec4(uGhost.rgb*(0.3+rimG*1.7), uGhost.a); return; }
  if(vMat>4.5 && vMat<5.5){ // face decals: mostly unlit so the expression always reads
    float sh = shadowAt(vW,N);
    vec3 c = vCol*(0.78+0.22*smoothstep(-0.05,0.1,dot(N,uSunDir))*sh) + flashLight(vCol,N,vW)*0.5;
        o = vec4(applyFog(c,vW),1.); return;
  }
  if(vMat>3.5 && vMat<4.5){ // eye white / iris: soft unlit
    o = vec4(applyFog(vCol*(0.9+0.2*uEyeGlow) + uGlowCol*uEyeGlow*1.6, vW),1.); return;
  }
  float sh = shadowAt(vW,N);
  vec3 c = toon(vCol,N,V,vW,sh);
  if(vMat>1.5 && vMat<2.5){ // hair: anisotropic-ish highlight band and power glow
    vec3 H = normalize(uSunDir+V);
    float s = pow(max(dot(N,H),0.),22.);
    c += step(0.5,s)*mix(vCol,vec3(1.),0.55)*0.35*sh;
    c += uGlowCol*uHairGlow*(0.25+rimG*1.5);
  } else if(vMat>5.5 && vMat<6.5) { c += uSunCol*0.18*pow(max(dot(N,normalize(uSunDir+V)),0.),40.)*sh; }
  else if(vMat>2.5 && vMat<3.5){ c = vCol*(1.+uEyeGlow*2.5)+uGlowCol*uEyeGlow*2.; }
  c += uGlowCol*uBodyGlow*(0.10+rimG*1.1);
  o = vec4(applyFog(c,vW),1.);
}`;

export const SHADOW_VS = VS_HEAD + `
layout(location=0) in vec3 aPos; layout(location=3) in vec2 aBone; layout(location=4) in vec2 aW; layout(location=5) in float aMat;
uniform mat4 uLightVP; uniform mat4 uBones[${MAX_BONES}]; uniform float uSkin;
void main(){
  vec4 p = vec4(aPos,1.);
  if(uSkin>0.5){ mat4 m = uBones[int(aBone.x+0.5)]*aW.x + uBones[int(aBone.y+0.5)]*aW.y; p = m*p; }
  if(aMat>2.5 && aMat<5.5){ gl_Position=vec4(2.,2.,2.,1.); return; }
  gl_Position = uLightVP*p;
}`;
export const SHADOW_FS = FS_HEAD + `void main(){}`;

export const AURA_VS = VS_HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
layout(location=3) in vec2 aBone; layout(location=4) in vec2 aW; layout(location=5) in float aMat;
uniform mat4 uVP; uniform mat4 uBones[${MAX_BONES}]; uniform float uAuraW; uniform float uTime;
out vec3 vN; out vec3 vW; out float vH;
void main(){
  mat4 m = uBones[int(aBone.x+0.5)]*aW.x + uBones[int(aBone.y+0.5)]*aW.y;
  vec4 p = m*vec4(aPos,1.); vec3 n = normalize(mat3(m)*aNrm);
  float wob = 0.6+0.4*sin(uTime*11.+p.y*9.+p.x*5.);
  if(aMat>2.5 && aMat<5.5){ gl_Position=vec4(2.,2.,2.,1.); vN=n; vW=p.xyz; vH=0.; return; }
  p.xyz += n*uAuraW*wob;
  vN=n; vW=p.xyz; vH=p.y;
  gl_Position = uVP*p;
}`;
export const AURA_FS = FS_HEAD + NOISE + `
in vec3 vN; in vec3 vW; in float vH;
uniform vec3 uCamPos; uniform vec3 uAuraCol1; uniform vec3 uAuraCol2; uniform float uAuraInt; uniform float uTime;
out vec4 o;
void main(){
  vec3 V = normalize(uCamPos-vW); vec3 N = normalize(vN);
  float fres = pow(1.-abs(dot(N,V)),1.8);
  float n = fbm(vec2(vW.x*2.6+vW.z*2.6, vW.y*2.2 - uTime*3.4));
  float streak = smoothstep(0.35,0.75,n);
  float a = (0.18+fres*1.0)*(0.35+streak*1.1)*uAuraInt;
  o = vec4(mix(uAuraCol1,uAuraCol2,streak)*a*1.8, a);
}`;

// ---------------------------------------------------------------- terrain (with animated crater deformation)
const CRATER = `
uniform float uTime; uniform int uCraterN; uniform vec4 uCraterA[${MAX_CRATERS}]; uniform vec4 uCraterB[${MAX_CRATERS}];
vec2 craterH(vec2 xz){
  float h=0., sc=0.;
  for(int i=0;i<${MAX_CRATERS};i++){
    if(i>=uCraterN) break;
    vec4 A=uCraterA[i]; vec4 B=uCraterB[i];
    if(uTime<B.x) continue;
    float k = clamp((uTime-B.x)/max(B.y,0.001),0.,1.);
    k = 1.-pow(1.-k,3.);
    float d = length(xz-A.xy)/A.z;
    float rough = 1.-0.28*noise2(xz*0.85+B.z);
    h += -A.w*k*(1.-smoothstep(0.,1.05,d))*rough + A.w*0.26*k*exp(-pow((d-1.12)/0.24,2.));
    sc = max(sc, k*(1.-smoothstep(0.,1.7,d)));
  }
  return vec2(h,sc);
}`;

export const TERRAIN_VS = VS_HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
uniform mat4 uVP;
${NOISE}
${CRATER}
out vec3 vW; out vec3 vN; out vec3 vCol; out float vScorch;
void main(){
  vec3 p = aPos;
  vec2 c0 = craterH(p.xz);
  p.y += c0.x;
  float e = 0.45;
  float hx = craterH(p.xz+vec2(e,0.)).x - craterH(p.xz-vec2(e,0.)).x;
  float hz = craterH(p.xz+vec2(0.,e)).x - craterH(p.xz-vec2(0.,e)).x;
  vN = normalize(aNrm + vec3(-hx,0.,-hz)/(2.*e));
  vW = p; vCol = aCol; vScorch = c0.y;
  gl_Position = uVP*vec4(p,1.);
}`;
export const TERRAIN_FS = FS_HEAD + NOISE + LIGHT + `
in vec3 vW; in vec3 vN; in vec3 vCol; in float vScorch;
out vec4 o;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(uCamPos-vW);
  float n = noise2(vW.xz*0.7)*0.6+noise2(vW.xz*2.3)*0.4;
  vec3 col = toLin(vCol)*(0.82+0.32*n);
  col = mix(col, col*vec3(0.33,0.28,0.26), vScorch*0.85);
  col *= 0.94+0.06*step(0.5,fract(vW.y*0.5));
  float sh = shadowAt(vW,N);
  vec3 c = toonR(col,N,V,vW,sh,0.);
  o = vec4(applyFog(c,vW),1.);
}`;

export const CRACK_VS = VS_HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec4 aAux;
uniform mat4 uVP;
${NOISE}
${CRATER}
out vec4 vAux; out vec3 vW;
void main(){
  vec3 p = aPos; p.y += craterH(p.xz).x + 0.035;
  vAux = aAux; vW = p;
  gl_Position = uVP*vec4(p,1.);
}`;
export const CRACK_FS = FS_HEAD + `
in vec4 vAux; in vec3 vW;
uniform float uTime; uniform float uGrow; uniform vec3 uCamPos; uniform vec3 uFogCol; uniform float uFogDen;
out vec4 o;
void main(){
  float age = uTime - vAux.x;
  if(age<0. || age*uGrow < vAux.y) discard;
  float e = abs(vAux.z);
  float core = 1.-smoothstep(0.35,1.,e);
  float glow = vAux.w * smoothstep(0.4,1.,e) * (1.-smoothstep(0.,4.,age)) ;
  vec3 c = mix(vec3(0.015,0.01,0.012), vec3(1.,0.55,0.18)*2.2, glow);
  float d = length(vW-uCamPos); float f = clamp(1.-exp(-d*uFogDen),0.,0.9);
  c = mix(c,uFogCol,f*0.6);
  o = vec4(c*core, core*0.92);
  if(core<0.02) discard;
}`;

// ---------------------------------------------------------------- instanced rocks / pillars (static, topple, shatter)
export const ROCK_VS = VS_HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
layout(location=6) in vec4 iA; layout(location=7) in vec4 iB; layout(location=8) in vec4 iC;
uniform mat4 uVP; uniform float uTime; uniform mat4 uLightVP; uniform float uShadowPass;
out vec3 vN; out vec3 vCol; out vec3 vW;
void main(){
  // iA: pos.xyz, yaw | iB: scale.xyz, breakTime | iC: tint.rgb, fallYaw (<0 = shatter)
  float c = cos(iA.w), s = sin(iA.w);
  vec3 lp = aPos*iB.xyz; vec3 ln = aNrm;
  vec3 wp = vec3(lp.x*c+lp.z*s, lp.y, -lp.x*s+lp.z*c);
  vec3 wn = vec3(ln.x*c+ln.z*s, ln.y, -ln.x*s+ln.z*c);
  float dt = uTime - iB.w;
  if(dt>0.){
    if(iC.w<0.){ wp *= 0.; }
    else {
      float ang = min(1.5, 0.32*dt*dt);
      vec3 ax = vec3(cos(iC.w), 0., -sin(iC.w)); // horizontal axis perpendicular to the fall direction
      // rotate about the base pivot (Rodrigues)
      float ca=cos(ang), sa=sin(ang);
      wp = wp*ca + cross(ax,wp)*sa + ax*dot(ax,wp)*(1.-ca);
      wn = wn*ca + cross(ax,wn)*sa + ax*dot(ax,wn)*(1.-ca);
    }
  }
  wp += iA.xyz;
  vW = wp; vN = normalize(wn); vCol = aCol*iC.rgb;
  gl_Position = (uShadowPass>0.5 ? uLightVP : uVP)*vec4(wp,1.);
}`;
export const ROCK_FS = FS_HEAD + NOISE + LIGHT + `
in vec3 vN; in vec3 vCol; in vec3 vW; out vec4 o;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(uCamPos-vW);
  vec3 col = toLin(vCol)*(0.9+0.1*step(0.5,fract(vW.y*0.42)))*(0.9+0.2*noise2(vW.xz*1.7+vW.y));
  float sh = shadowAt(vW,N);
  o = vec4(applyFog(toonR(col,N,V,vW,sh,0.3),vW),1.);
}`;

// ---------------------------------------------------------------- debris chunks (closed-form ballistic + one bounce)
export const DEBRIS_VS = VS_HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
layout(location=6) in vec4 d0; layout(location=7) in vec4 d1; layout(location=8) in vec4 d2; layout(location=9) in vec4 d3; layout(location=10) in vec4 d4;
uniform mat4 uVP; uniform float uTime; uniform mat4 uLightVP; uniform float uShadowPass;
out vec3 vN; out vec3 vCol; out vec3 vW;
void main(){
  // d0: p0.xyz, birth | d1: v0.xyz, life | d2: spinAxis.xyz, spin | d3: size, groundY, restitution | d4: tint.rgb
  float t = uTime - d0.w;
  if(t<0. || t>d1.w){ gl_Position=vec4(2.,2.,2.,1.); vN=aNrm; vCol=aCol; vW=aPos; return; }
  vec3 v0=d1.xyz; float gY=d3.y; float g=9.8;
  float disc = v0.y*v0.y + 2.*g*max(d0.y-gY,0.);
  float t1 = (v0.y + sqrt(disc))/g;
  vec3 p;
  if(t<t1){ p = d0.xyz + v0*t; p.y = d0.y + v0.y*t - 0.5*g*t*t; }
  else {
    float tb = t-t1; float vy = (g*t1 - v0.y)*d3.z;
    p = d0.xyz + v0*t1; p.xz += v0.xz*0.35*min(tb,1.4);
    float y = gY + vy*tb - 0.5*g*tb*tb; p.y = max(gY,y);
  }
  float ang = d2.w*min(t, t1+0.35);
  vec3 ax = normalize(d2.xyz); float ca=cos(ang), sa=sin(ang);
  vec3 lp = aPos*d3.x*(1.-smoothstep(d1.w-1.2,d1.w,t));
  vec3 rp = lp*ca + cross(ax,lp)*sa + ax*dot(ax,lp)*(1.-ca);
  vec3 rn = aNrm*ca + cross(ax,aNrm)*sa + ax*dot(ax,aNrm)*(1.-ca);
  vW = p+rp; vN = normalize(rn); vCol = aCol*d4.rgb;
  gl_Position = (uShadowPass>0.5 ? uLightVP : uVP)*vec4(vW,1.);
}`;

// ---------------------------------------------------------------- particles (GPU-evaluated, pooled instance buffers)
export const PARTICLE_VS = VS_HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 a0; layout(location=2) in vec4 a1; layout(location=3) in vec4 a2;
layout(location=4) in vec4 a3; layout(location=5) in vec4 a4; layout(location=6) in vec4 a5;
uniform mat4 uVP; uniform float uTime; uniform vec3 uCamRight; uniform vec3 uCamUp; uniform vec3 uCamPos; uniform vec3 uAnchor[10]; uniform float uScaleAll;
out vec2 vUV; out vec4 vCol; out float vShape; out float vK; out float vSeed;
void main(){
  float age = uTime - a0.w; float life = a1.w; float k = age/life;
  if(age<0. || k>1.){ gl_Position=vec4(2.,2.,2.,1.); vUV=vec2(0.); vCol=vec4(0.); vShape=0.; vK=0.; vSeed=0.; return; }
  float drag = a5.y; vec3 v0=a1.xyz;
  float dd = drag>0.001 ? (1.-exp(-drag*age))/drag : age;
  vec3 p = a0.xyz + v0*dd; p.y -= 0.5*a5.x*age*age;
  int an = int(a5.z+0.5); if(an>0) p += uAnchor[an-1];
  float size = mix(a4.x,a4.y,k)*uScaleAll;
  vec3 wpos;
  if(a5.w>0.5 && a5.w<1.5){ // streak / spark
    vec3 vel = v0*exp(-drag*age) + vec3(0.,-a5.x*age,0.);
    float sp = length(vel);
    vec3 X = sp>0.001 ? vel/sp : vec3(0.,1.,0.);
    vec3 Y = normalize(cross(X, normalize(p-uCamPos)));
    float len = size*(1.+min(sp*0.07,7.));
    wpos = p + X*aCorner.x*len + Y*aCorner.y*size*0.32;
  } else {
    float ang = a4.z + a4.w*age; float c=cos(ang), s=sin(ang);
    wpos = p + (uCamRight*(c*aCorner.x - s*aCorner.y) + uCamUp*(s*aCorner.x + c*aCorner.y))*size;
  }
  float env = smoothstep(0.,0.05,k)*(1.-smoothstep(0.5,1.,k));
  vCol = mix(a2,a3,k); vCol.a *= env;
  vUV = aCorner; vShape = a5.w; vK = k; vSeed = a0.x*1.7+a0.z*3.1+a0.w;
  gl_Position = uVP*vec4(wpos,1.);
}`;
export const PARTICLE_FS = FS_HEAD + NOISE + `
in vec2 vUV; in vec4 vCol; in float vShape; in float vK; in float vSeed;
uniform float uAdditive;
out vec4 o;
void main(){
  float r = length(vUV); float a; vec3 col = vCol.rgb;
  if(vShape<0.5){ a = pow(clamp(1.-r,0.,1.),1.6); }
  else if(vShape<1.5){ a = smoothstep(1.,0.,abs(vUV.y))*smoothstep(1.,0.55,abs(vUV.x)); col = mix(col,vec3(1.),smoothstep(0.55,0.,abs(vUV.y))*0.7); }
  else if(vShape<2.5){ // toon smoke puff
    float n = fbm(vUV*2.1+vSeed);
    a = smoothstep(1.,0.62,r)*smoothstep(0.22,0.58,n+0.28-r*0.3);
    float tone = step(0.52, dot(normalize(vUV+0.001), vec2(-0.45,0.75))*0.5+0.5 + n*0.35 - r*0.25);
    col *= mix(0.6,1.05,tone);
  }
  else if(vShape<3.5){ // flame tongue (y up)
    float y = vUV.y*0.5+0.5; float w = mix(0.9,0.08,y);
    float wob = (fbm(vec2(vUV.y*3.+vSeed, vK*6.))-0.5)*0.5;
    a = smoothstep(w,w*0.55,abs(vUV.x+wob*y))*smoothstep(1.,0.75,y)*smoothstep(0.,0.15,y);
    col = mix(col, vec3(1.), (1.-y)*0.5*smoothstep(0.6,0.,abs(vUV.x)));
  }
  else if(vShape<4.5){ a = smoothstep(0.18,0.,abs(r-0.82)); }
  else { a = 1.-smoothstep(0.8,1.,r); col *= 0.75+0.25*step(0.,vUV.x); }
  a *= vCol.a;
  if(a<0.003) discard;
  if(uAdditive>0.5) o = vec4(col*a,0.); else o = vec4(col*a,a);
}`;

// ---------------------------------------------------------------- glow batch (lightning, beams, trails, sprites)
export const GLOW_VS = VS_HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; layout(location=2) in vec4 aCol; layout(location=3) in float aShape;
uniform mat4 uVP; out vec2 vUV; out vec4 vCol; out float vShape;
void main(){ vUV=aUV; vCol=aCol; vShape=aShape; gl_Position=uVP*vec4(aPos,1.); }`;
export const GLOW_FS = FS_HEAD + `
in vec2 vUV; in vec4 vCol; in float vShape; out vec4 o;
void main(){
  float r = length(vUV); float a;
  if(vShape<0.5) a = pow(clamp(1.-abs(vUV.y),0.,1.),1.5);
  else if(vShape<1.5) a = pow(clamp(1.-r,0.,1.),2.2);
  else if(vShape<2.5) a = smoothstep(0.16,0.,abs(r-0.84));
  else a = 1.-smoothstep(0.55,1.,abs(vUV.y));
  o = vec4(vCol.rgb*vCol.a*a,0.);
}`;

// ---------------------------------------------------------------- shockwave ring / dome
export const RING_VS = VS_HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
uniform mat4 uVP; uniform mat4 uModel; out vec3 vL; out vec3 vN; out vec3 vW;
void main(){ vL=aPos; vN=mat3(uModel)*aNrm; vec4 w=uModel*vec4(aPos,1.); vW=w.xyz; gl_Position=uVP*w; }`;
export const RING_FS = FS_HEAD + NOISE + `
in vec3 vL; in vec3 vN; in vec3 vW;
uniform float uMode; uniform float uR; uniform float uThick; uniform vec4 uColor; uniform vec3 uCamPos; uniform float uTime;
out vec4 o;
void main(){
  float a;
  if(uMode<0.5){ // flat ground ring: vL.xz in -1..1 (unit disc)
    float r = length(vL.xz);
    float x = (r-uR)/max(uThick,0.001);
    float ang = atan(vL.z,vL.x);
    float jag = 0.85+0.3*noise2(vec2(ang*3.,uTime*2.));
    a = (x>0.?0.:pow(clamp(1.+x,0.,1.),3.)) * smoothstep(0.05,-0.02,x) * jag;
    if(r>1.) a=0.;
  } else { // dome / sphere shell: fresnel with fading edge
    vec3 V = normalize(uCamPos-vW); float f = pow(1.-abs(dot(normalize(vN),V)),2.4);
    a = (0.12+f)*(0.6+0.4*noise2(vL.xy*3.+vL.z*2.+uTime*4.));
  }
  o = vec4(uColor.rgb*a*uColor.a,0.);
}`;

// ---------------------------------------------------------------- sky
export const SKY_VS = VS_HEAD + `
out vec2 vNdc;
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vNdc = p*2.-1.; gl_Position = vec4(vNdc,1.,1.); }`;
export const SKY_FS = FS_HEAD + NOISE + `
in vec2 vNdc; uniform mat4 uInvVP; uniform vec3 uCamPos; uniform float uTime;
uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uGlow;
uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uCloudCover; uniform vec2 uWind; uniform vec3 uFogCol;
out vec4 o;
void main(){
  vec4 f = uInvVP*vec4(vNdc,1.,1.); vec4 n = uInvVP*vec4(vNdc,-1.,1.);
  vec3 dir = normalize(f.xyz/f.w - n.xyz/n.w);
  float h = dir.y;
  vec3 col = mix(uSkyHor, uSkyTop, pow(smoothstep(-0.02,0.7,h),0.65));
  float sd = max(dot(dir,uSunDir),0.);
  col += uSunCol*(pow(sd,90.)*uGlow*1.6 + pow(sd,7.)*uGlow*0.22);
  col += uSunCol*smoothstep(0.9993,0.9997,sd)*2.5;
  // toon clouds projected on a plane
  if(h>0.012){
    float t = 900./h;
    vec2 cp = (uCamPos.xz + dir.xz*t)*0.0016 + uWind*uTime*0.004;
    float nn = fbm(cp*2.2);
    float m = smoothstep(uCloudCover,uCloudCover+0.035,nn);
    float nn2 = fbm(cp*2.2+uSunDir.xz*0.16);
    float lit = smoothstep(0.,0.05,nn-nn2+0.012);
    vec3 cc = mix(uCloudShade,uCloudLit,lit);
    float fade = smoothstep(0.012,0.2,h);
    col = mix(col, cc, m*fade*0.95);
  }
  float below = smoothstep(0.02,-0.06,h);
  col = mix(col, uFogCol*0.92, below);
  col = mix(col, uFogCol, smoothstep(0.09,-0.01,h)*0.55);
  o = vec4(col,1.);
}`;
