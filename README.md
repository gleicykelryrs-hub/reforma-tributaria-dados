# Reforma Tributária na Prática – tabela oficial sincronizada

Todo dia às 06h17 (Brasília) o GitHub Actions:

1. baixa o repositório oficial da Receita Federal (calculadora-rtc-regime-regular);
2. reconstrói a base (scripts flyway/sql) e exporta a tabela de cClassTrib em `dados/oficial.json`;
3. roda os casos de teste oficiais contra o motor de cálculo do sistema;
4. só substitui `dados/oficial.json` se nenhum caso der diferente. O resultado fica em `dados/status.json`.

O sistema lê os arquivos de `dados/` ao abrir. Se a tabela nova for reprovada, ele continua com a anterior.
