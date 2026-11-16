import { REGION_STATES } from './region-boundaries.js';

export const MAP_WIDTH = 800;
export const MAP_HEIGHT = 640;
const standardParallel = Math.cos(37*Math.PI/180);
const raw = (longitude,latitude) => [longitude*standardParallel,-latitude];

/** Equirectangular projection at 37°N. Boundaries and markers share this transform. */
export function createRegionProjection(region='all') {
  const states = REGION_STATES.filter(state => region==='all' ? ['CA','AZ'].includes(state.id) : state.id===region);
  if (!states.length) throw new RangeError('Unknown map region');
  const points = states.flatMap(state => state.rings.flat()).map(([lon,lat]) => raw(lon,lat));
  const xs=points.map(point=>point[0]), ys=points.map(point=>point[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.min((MAP_WIDTH-96)/(maxX-minX),(MAP_HEIGHT-96)/(maxY-minY));
  return (longitude,latitude) => {
    if (!Number.isFinite(longitude)||!Number.isFinite(latitude)) throw new TypeError('Invalid coordinates');
    const [x,y]=raw(longitude,latitude);
    return [MAP_WIDTH/2+(x-(minX+maxX)/2)*scale,MAP_HEIGHT/2+(y-(minY+maxY)/2)*scale];
  };
}

export function statePath(state,project) {
  return state.rings.map(ring => ring.map(([lon,lat],index) =>
    `${index?'L':'M'}${project(lon,lat).map(value=>value.toFixed(2)).join(',')}`).join(' ')+'Z').join(' ');
}

/** Spread numbered buttons in screen pixels; leader lines preserve true coordinates. */
export function spreadMarkers(anchors,width,height) {
  const points=anchors.map(point=>({...point}));
  const gap=36, edge=20;
  for (let pass=0;pass<80;pass++) {
    let moved=false;
    for (let i=0;i<points.length;i++) for (let j=i+1;j<points.length;j++) {
      const a=points[i],b=points[j],dx=b.x-a.x,dy=b.y-a.y;
      const distance=Math.hypot(dx,dy);
      if (distance>=gap) continue;
      const ux=distance?dx/distance:1,uy=distance?dy/distance:0;
      const shift=(gap-distance)/2+.1;
      a.x-=ux*shift;a.y-=uy*shift;b.x+=ux*shift;b.y+=uy*shift;moved=true;
    }
    for (const point of points) {
      point.x=Math.max(edge,Math.min(width-edge,point.x));
      point.y=Math.max(edge,Math.min(height-edge,point.y));
    }
    if (!moved) break;
  }
  return points;
}
