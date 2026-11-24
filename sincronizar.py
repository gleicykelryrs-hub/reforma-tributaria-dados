#!/usr/bin/env python3
"""Reconstrói a base da Calculadora de Tributos (regime regular) a partir do repositório oficial da Receita Federal
e exporta a tabela usada pelo sistema. Uso: sincronizar.py <pasta do repositório> <saida.json>
A base é montada do mesmo jeito que o projeto oficial faz: scripts de flyway/sql, em ordem de versão."""
import sqlite3, json, sys, re, os, glob, subprocess, datetime

def versao(arq):
    m = re.match(r'[VB](\d+)', os.path.basename(arq)); return int(m.group(1)) if m else -1

def montar(repo):
    sqls = glob.glob(os.path.join(repo, 'flyway', 'sql', '**', '*.sql'), recursive=True)
    base = [a for a in sqls if os.path.basename(a).startswith('B')]
    migr = sorted([a for a in sqls if os.path.basename(a).startswith('V')], key=versao)
    b0 = max(base, key=versao) if base else None
    db = sqlite3.connect(':memory:')
    aplicados = []
    for arq in ([b0] if b0 else []) + [a for a in migr if not b0 or versao(a) > versao(b0)]:
        txt = open(arq, encoding='utf-8').read()
        # O Flyway roda cada migração V dentro de uma transação (é o que faz "PRAGMA defer_foreign_keys" valer), menos as que mexem em
        # "PRAGMA foreign_keys", que rodam fora de transação (flyway.mixed=true). O baseline B cuida da própria checagem.
        if os.path.basename(arq).startswith('V') and not re.search(r'(?im)^\s*(BEGIN\b|PRAGMA\s+foreign_keys)', txt): txt = 'BEGIN;\n' + txt + '\nCOMMIT;'
        db.executescript(txt); aplicados.append(os.path.basename(arq))
    return db, aplicados

def exportar(db, repo):
    q = lambda s, *a: db.execute(s, a).fetchall()
    cbs = "(select TRST_SITR_ID from TRIBUTO_SITUACAO_TRIBUTARIA where TRST_TBTO_ID=2)"
    classes = []
    for id_, cd, d, cst, ta, fim in q(f"select CLTR_ID,CLTR_CD,CLTR_DESCRICAO,SITR_CD,CLTR_TIPO_ALIQUOTA,CLTR_FIM_VIGENCIA from CLASSIFICACAO_TRIBUTARIA join SITUACAO_TRIBUTARIA on SITR_ID=CLTR_SITR_ID where CLTR_SITR_ID in {cbs} order by CLTR_CD"):
        t = q("select TRTR_ID,TRTR_DESCRICAO,TRTR_EXPRESSAO_ALIQUOTA,TRTR_EXPRESSAO_BASE_CALCULO,TRTR_EXPRESSAO_VALOR_DIFERIMENTO,TRTR_IN_POSSUI_MONOFASIA from TRATAMENTO_CLASSIFICACAO join TRATAMENTO_TRIBUTARIO on TRTR_ID=TRCL_TRTR_ID where TRCL_CLTR_ID=? and TRCL_FIM_VIGENCIA is null", id_)
        red = dict(q("select PERE_TBTO_ID,PERE_VALOR from PERCENTUAL_REDUCAO where PERE_CLTR_ID=? and PERE_FIM_VIGENCIA is null", id_))
        fixa = q("select AADV_TBTO_ID,AADV_VALOR,AADV_INICIO_VIGENCIA,AADV_FIM_VIGENCIA from ALIQUOTA_AD_VALOREM where AADV_CLTR_ID=?", id_)
        lei = q("select FDLG_TEXTO_CURTO from FUNDAMENTACAO_CLASSIFICACAO join FUNDAMENTACAO_LEGAL on FDLG_ID=FDCL_FDLG_ID where FDCL_CLTR_ID=? and FDCL_FIM_VIGENCIA is null", id_)
        if fim or not t: k, tn = 'off', 'Sem tratamento ativo na calculadora oficial'
        else:
            tid, tn, al, base, dif, mono = t[0]
            if mono or tid in (23, 24, 25, 26, 27, 28, 41, 42): k = 'mono'
            elif al == '0' or (base and '1-100/100' in base) or ta == 'Sem alíquota': k = 'zero'
            elif dif: k = 'dif'
            elif base and '*0.5' in base: k = 'base50'
            elif fixa or ta in ('Fixa', 'Uniforme setorial'): k = 'fixa'
            else: k = 'normal'
        e = dict(c=cd, d=d, cst=cst, r=red.get(2, 0) or 0, ri=red.get(3, 0) or 0, b=(lei[0][0] if lei else '') or '', t=k, tn=tn)
        if fixa: e['fx'] = [list(f) for f in fixa]
        classes.append(e)
    cst = [dict(c=c, d=d) for c, d in q(f"select SITR_CD,SITR_DESCRICAO from SITUACAO_TRIBUTARIA where SITR_ID in {cbs} order by SITR_CD")]
    ref = [dict(tributo=s, valor=v, inicio=i, fim=f) for s, v, i, f in q("select TBTO_SIGLA,ALRE_VALOR,ALRE_INICIO_VIGENCIA,ALRE_FIM_VIGENCIA from ALIQUOTA_REFERENCIA join TRIBUTO on TBTO_ID=ALRE_TBTO_ID order by ALRE_INICIO_VIGENCIA,TBTO_ID")]
    ult = q("select * from VERSAO_BASE_DADO order by rowid desc limit 1")[0]
    def git(*a):
        try: return subprocess.check_output(['git', '-C', repo, *a], text=True).strip()
        except Exception: return ''
    pom = open(os.path.join(repo, 'pom.xml'), encoding='utf-8').read()
    rel = re.search(r'<artifactId>CalculadorTributo</artifactId>\s*<version>([^<]+)<', pom)
    return dict(versao=str(ult[-1]), dataBase=str(ult[1])[:10], release=(rel.group(1) if rel else ''), commit=git('rev-parse', 'HEAD')[:12], commitData=git('log', '-1', '--format=%cI')[:10],
                sincronizadoEm=datetime.date.today().isoformat(), aliquotasReferencia=ref, cst=cst, cclass=classes)

if __name__ == '__main__':
    repo, saida = sys.argv[1], sys.argv[2]
    db, aplicados = montar(repo)
    d = exportar(db, repo)
    json.dump(d, open(saida, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f"{len(aplicados)} scripts aplicados; versão {d['versao']} ({d['dataBase']}); release {d['release']}; {len(d['cclass'])} classificações; {len(d['cst'])} CST; alíquotas de referência: {d['aliquotasReferencia']}")
