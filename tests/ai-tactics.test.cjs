const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),A=G.aiTactics;
function battle(ownCount,enemyCount){
 const armies=Array(G.getMap().spawns.length).fill(null);armies[0]=armies[1]=[{unitId:'Type61',kitId:'standard'}];
 const game=G.create(false,1,armies,false,{costLimit:99999}),source=game.units[0];game.units=[];
 for(const [team,count]of [[0,ownCount],[1,enemyCount]])for(let i=0;i<count;i++)
  game.units.push({...source,id:team+'-'+i,team,ownerSeat:team,x:team?40:10,y:20+i});
 game.team=0;return {game,unit:game.units[0]};
}
test('encounter AI advances without waiting for retired strategic reinforcement rules',()=>{
 const {game,unit}=battle(2,8);assert.equal(A.decide(G,game,unit).state,'advance');
 const strong=battle(8,2);assert.equal(A.decide(G,strong.game,strong.unit).state,'overrun');
});
test('one tactical decision is shared per controller and phase',()=>{
 const {game,unit}=battle(4,4),decision=A.decide(G,game,unit);
 assert.equal(A.decide(G,game,game.units[1]),decision);game.round++;
 assert.notEqual(A.decide(G,game,unit),decision);
});
test('flank groups choose opposite sides while easy difficulty keeps a direct approach',()=>{
 const {game,unit}=battle(4,4);game.aiOptions=A.settings({difficulty:'hard'});for(const u of game.units)u.y=20;
 const d=A.decide(G,game,unit);assert.equal(d.state,'flank');
 const top={x:35,y:16},bottom={x:35,y:24};
 assert(A.positionScore(G,game,unit,top,d)>A.positionScore(G,game,unit,bottom,d));
 assert(A.positionScore(G,game,game.units[1],bottom,d)>A.positionScore(G,game,game.units[1],top,d));
 const easy=battle(4,4);easy.game.aiOptions=A.settings({difficulty:'easy'});assert.equal(A.decide(G,easy.game,easy.unit).state,'advance');
});
