const test=require("node:test"),assert=require("node:assert/strict");
const world=require("../assets/maps/strategy/earth_0079_mid/world.json");
function contains(path,x,y){
 let inside=false;
 for(const ring of path.matchAll(/M([^Z]+)Z/g)){
  const points=ring[1].split('L').map(p=>p.split(',').map(Number));
  for(let i=0,j=points.length-1;i<points.length;j=i++){
   const [ax,ay]=points[i],[bx,by]=points[j];
   if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  }
 }
 return inside;
}
test("East Asian mainland and islands remain in their configured strategic regions",()=>{
 for(const [name,lon,lat,id]of [
  ["South Korea",127.2,37.4,"beijing"],["North Korea",127,40,"beijing"],
  ["Shandong",117,36,"beijing"],["Guangdong",113,24,"china"],["Fujian",117,26,"china"],
  ["Guangxi",108,23,"china"],["Yunnan",102,25,"china"],
  ["North Taiwan",121.2,24.5,"china"],["South Taiwan",120.7,23,"china"],
  ["Honshu",137,36.5,"japan"],["Hokkaido",142.5,43,"japan"],
 ]){
  const x=(lon+180)*world.width/360,y=(85-lat)*world.height/145;
  const regions=world.regions.filter(r=>r.kind==='land'&&contains(r.path,x,y));
  assert.deepEqual(regions.map(r=>r.id),[id],name);
 }
});
