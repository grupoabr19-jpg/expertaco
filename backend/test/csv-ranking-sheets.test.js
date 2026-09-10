const test=require('node:test'),assert=require('node:assert/strict');
const {rankingFromCsv}=require('../csv-ranking-sheets');
test('converte valores brasileiros do Sheets',()=>{
 const csv='"type","id","name","route","role","leader","sales_amount","target_amount","challenge_target_amount","tons","target_tons","challenge_target_tons","period"\n"team","i","Itajubá","Itajubá","Equipe","Fulano","R$ 250.000,00","R$ 100.000,00","R$ 1.100.000,00","1.500,5","2000","2200","2026-08"';
 const t=rankingFromCsv(csv).teams[0];
 assert.equal(t.salesAmount,250000);assert.equal(t.targetAmount,100000);assert.equal(t.challengeTargetAmount,1100000);assert.equal(t.tons,1500.5);
});
