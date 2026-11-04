// Serve a pasta da prévia local (montar-previa.js). Uso: node scripts/servir-previa.js <pasta> [porta]
const http = require('http');
const fs = require('fs');
const path = require('path');
const pasta = path.resolve(process.argv[2] || 'previa');
const porta = Number(process.argv[3] || 8765);
http.createServer((req, res) => {
  const nome = path.basename(decodeURIComponent(req.url.split('?')[0])) || 'index.html';
  fs.readFile(path.join(pasta, nome), (err, conteudo) => {
    if (err) { res.writeHead(404); res.end('não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(conteudo);
  });
}).listen(porta, '127.0.0.1', () => console.log('prévia em http://localhost:' + porta));
