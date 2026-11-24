#!/usr/bin/env node
/* Confere a tabela recém-gerada contra os casos de teste do repositório oficial e decide se ela pode ser publicada.
   Uso: node conferir.js <pasta do repositório oficial> <novo.json> <pasta dados>
   Grava <dados>/status.json sempre e substitui <dados>/oficial.json só quando todos os casos batem. */
const fs = require('fs'), path = require('path');
const [repo, novoArq, dados] = process.argv.slice(2);
global.window = global; require('./lib/params.js'); const E = require('./lib/engine.js'), P = global.RTParams;
const novo = JSON.parse(fs.readFileSync(novoArq, 'utf8')), antArq = path.join(dados, 'oficial.json');
const ant = fs.existsSync(antArq) ? JSON.parse(fs.readFileSync(antArq, 'utf8')) : null;

const R = path.join(repo, 'src', 'test'), dirJ = path.join(R, 'java/br/gov/serpro/rtc/testesintegracao/calculoscorretos/cbsibs');
const num = (s) => (s == null ? null : /ZERO/.test(s) ? 0 : parseFloat(s.replace(/[^0-9.]/g, '')));
const pega = (src, m) => { const x = src.match(new RegExp(m + '\\(\\),\\s*((?:new BigDecimal\\()?"?[\\w.]+"?\\)?)\\)')); return x ? num(x[1]) : null; };
const casos = [];
if (fs.existsSync(dirJ)) for (const d of fs.readdirSync(dirJ)) for (const f of fs.readdirSync(path.join(dirJ, d))) {
  const src = fs.readFileSync(path.join(dirJ, d, f), 'utf8'), j = src.match(/entradas\/[^"]+\.json/); if (!j) continue;
  const exp = { base: pega(src, 'getValorBaseCalculoIBSCBS'), pCBS: pega(src, 'getPCBS'), vCBS: pega(src, 'getVCBS'), pUF: pega(src, 'getPIBSUF'), vUF: pega(src, 'getVIBSUF'), pMun: pega(src, 'getPIBSMun'), vMun: pega(src, 'getVIBSMun') };
  if (exp.vCBS == null || exp.base == null) continue;
  const arq = path.join(R, 'resources', j[0]); if (!fs.existsSync(arq)) continue;
  const inp = JSON.parse(fs.readFileSync(arq, 'utf8')), it = inp.itens[0];
  casos.push({ nome: f.replace('.java', ''), ano: +(inp.dataHoraEmissao || inp.dhFatoGerador).slice(0, 4), cclass: it.cClassTrib, exp });
}
let iguais = 0, fora = 0; const diferentes = [];
for (const c of casos) {
  const cc = novo.cclass.find((x) => x.c === c.cclass); if (!cc) { fora++; continue; }
  const al = E.aliquotasAno(Math.min(2033, Math.max(2026, c.ano)), P, 'base'), pt = E.ibsPartes(c.ano, al.ibs);
  const t = E.tributoItem(c.exp.base, cc, c.exp.pCBS > 0 ? { cbs: c.exp.pCBS, ibsUF: c.exp.pUF, ibsMun: c.exp.pMun } : { cbs: al.cbs, ibsUF: pt[0], ibsMun: pt[1] });
  if (Math.abs(t.cbs - c.exp.vCBS) < 0.005 && Math.abs(t.ibsUF - c.exp.vUF) < 0.005 && Math.abs(t.ibsMun - c.exp.vMun) < 0.005) iguais++;
  else diferentes.push(`${c.nome} (${c.cclass}, ${c.ano}): oficial ${c.exp.vCBS}/${c.exp.vUF}/${c.exp.vMun}, sistema ${t.cbs}/${t.ibsUF}/${t.ibsMun}`);
}
/* O que mudou em relação à tabela publicada */
const mapa = (o) => Object.fromEntries((o ? o.cclass : []).map((x) => [x.c, JSON.stringify([x.d, x.cst, x.r, x.ri, x.t, x.tn, x.fx || null])]));
const a = mapa(ant), b = mapa(novo), mudou = { novas: Object.keys(b).filter((k) => !(k in a)), removidas: Object.keys(a).filter((k) => !(k in b)), alteradas: Object.keys(b).filter((k) => k in a && a[k] !== b[k]) };
const alertas = [];
const refNova = (novo.aliquotasReferencia || []).filter((r) => r.inicio >= '2027');
if (refNova.length) alertas.push('A base oficial passou a trazer alíquota de referência para 2027 em diante: ' + refNova.map((r) => `${r.tributo} ${r.valor}% a partir de ${r.inicio}`).join('; ') + '. Revisar os parâmetros do sistema.');
if (ant && (mudou.novas.length || mudou.removidas.length || mudou.alteradas.length)) alertas.push(`Tabela de classificações alterada: ${mudou.novas.length} novas, ${mudou.removidas.length} removidas, ${mudou.alteradas.length} alteradas.`);
const tratDesconhecido = novo.cclass.filter((x) => !['normal', 'zero', 'mono', 'dif', 'off', 'base50', 'fixa'].includes(x.t));
/* Regras de segurança: só publica se os casos oficiais batem, se houve casos para conferir e se a tabela não encolheu de forma anormal. */
const motivos = [];
if (diferentes.length) motivos.push(`${diferentes.length} caso(s) oficial(is) com resultado diferente`);
if (casos.length < 10) motivos.push('menos de 10 casos de teste encontrados no repositório oficial (a estrutura do repositório mudou)');
if (novo.cclass.length < 100) motivos.push('tabela com menos de 100 classificações');
if (ant && novo.cclass.length < ant.cclass.length * 0.8) motivos.push('tabela perdeu mais de 20% das classificações');
if (tratDesconhecido.length) motivos.push('tratamento tributário desconhecido');
const aprovada = motivos.length === 0;
const status = { aprovada, sincronizadoEm: novo.sincronizadoEm, conferidoEm: new Date().toISOString(), versao: novo.versao, dataBase: novo.dataBase, release: novo.release, commit: novo.commit, commitData: novo.commitData,
  classificacoes: novo.cclass.length, testes: { casos: casos.length, iguais, diferentes: diferentes.length, fora }, detalhes: diferentes, motivos, mudou, alertas, aliquotasReferencia: novo.aliquotasReferencia,
  emUso: aprovada ? novo.versao : (ant ? ant.versao : null) };
fs.mkdirSync(dados, { recursive: true });
fs.writeFileSync(path.join(dados, 'status.json'), JSON.stringify(status, null, 1));
if (aprovada) fs.writeFileSync(antArq, JSON.stringify(novo));
console.log(aprovada ? `APROVADA: versão ${novo.versao}, ${iguais} de ${casos.length} casos iguais (${fora} fora da base).` : `REPROVADA: ${motivos.join('; ')}. A tabela anterior continua em uso.`);
alertas.forEach((x) => console.log('ALERTA:', x));
process.exit(aprovada ? 0 : 1);
