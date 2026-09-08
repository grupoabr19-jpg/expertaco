const test = require('node:test');
const assert = require('node:assert/strict');
const { rankingFromSpreadsheetCsv } = require('../ranking-spreadsheet');

test('converte os rankings prontos das abas de vendedores e regioes', () => {
  const sellers = 'Posição,Vendedor,Região,Segmento,Meta mês (kg),Meta diária (kg),Vendas no dia (kg),% meta diária,Acumulado no mês (kg),% meta mensal — ranking,Status do ritmo\n1,HELOÁ,BRAG. PTA.,VCORP,"90.576,00 kg","4.313,14 kg","10.789,83 kg",2.5,"21.137,22 kg","23,3%",No ritmo / acima';
  const teams = 'Posição,Região,Meta mês (kg),Acumulado no mês (kg),% da meta — ranking,Vendas no dia (kg),Meta acumulada (kg),Ritmo acumulado\n1,BRAG. PTA.,"200.174,00 kg","27.151,18 kg","13,6%","13.364,50 kg","19.064,19 kg",142.4';
  const ranking = rankingFromSpreadsheetCsv(sellers, teams);
  assert.equal(ranking.sellers[0].name, 'HELOÁ');
  assert.equal(ranking.sellers[0].tons, 21.13722);
  assert.equal(ranking.sellers[0].attainment, 23.3);
  assert.equal(ranking.teams[0].name, 'BRAG. PTA.');
  assert.equal(ranking.teams[0].leader, 'Alessandro');
  assert.equal(ranking.teams[0].tons, 27.15118);
  assert.equal(ranking.teams[0].attainment, 13.6);
  assert.equal(ranking.goalSummary.soldTons, 27.15118);
  assert.equal(ranking.goalSummary.targetTons, 200.174);
  assert.equal(ranking.goalSummary.attainment, 13.6);
  assert.equal(ranking.goalSummary.challengeTargetTons15, 230.2001);
  assert.equal(ranking.goalSummary.challengeTargetTons30, 260.2262);
});
