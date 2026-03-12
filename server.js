const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const db = new sqlite3.Database(path.join(__dirname, 'atendimentos.db'), (err) => {
  if (err) { console.error('Erro ao abrir banco:', err.message); process.exit(1); }
  console.log('Banco de dados conectado: atendimentos.db');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      nome           TEXT NOT NULL,
      telefone       TEXT NOT NULL,
      matricula      TEXT NOT NULL UNIQUE,
      observacoes    TEXT DEFAULT '',
      data_cadastro  TEXT NOT NULL,
      acesso_maquina INTEGER DEFAULT 0,
      chegou_maquina INTEGER DEFAULT 0
    )
  `);
  // Adiciona colunas em bases existentes (ignora erro se já existir)
  db.run(`ALTER TABLE clientes ADD COLUMN acesso_maquina INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE clientes ADD COLUMN chegou_maquina INTEGER DEFAULT 0`, () => {});
  db.run(`
    CREATE TABLE IF NOT EXISTS historico_observacoes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      texto      TEXT NOT NULL,
      data_hora  TEXT NOT NULL,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    )
  `);
});

app.use(express.json());
app.use(express.static(__dirname));

// Listar todos
app.get('/api/clientes', (req, res) => {
  db.all('SELECT * FROM clientes ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar dados.' });
    res.json(rows);
  });
});

// Criar
app.post('/api/clientes', (req, res) => {
  const { nome, telefone, matricula, observacoes } = req.body;
  if (!nome || !telefone || !matricula)
    return res.status(400).json({ erro: 'Campos obrigatórios ausentes.' });

  const data_cadastro = new Date().toLocaleDateString('pt-BR');
  db.run(
    'INSERT INTO clientes (nome, telefone, matricula, observacoes, data_cadastro) VALUES (?,?,?,?,?)',
    [nome, telefone, matricula.toUpperCase(), observacoes || '', data_cadastro],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE'))
          return res.status(409).json({ erro: 'Matrícula já cadastrada.' });
        return res.status(500).json({ erro: 'Erro ao salvar.' });
      }
      const clienteId = this.lastID;
      const obs = (observacoes || '').trim();
      const afterInsert = () => {
        db.get('SELECT * FROM clientes WHERE id = ?', [clienteId], (err, row) => {
          res.status(201).json(row);
        });
      };
      if (obs) {
        const dataHora = new Date().toLocaleString('pt-BR');
        db.run(
          'INSERT INTO historico_observacoes (cliente_id, texto, data_hora) VALUES (?,?,?)',
          [clienteId, obs, dataHora],
          afterInsert
        );
      } else {
        afterInsert();
      }
    }
  );
});

// Atualizar
app.put('/api/clientes/:id', (req, res) => {
  const { nome, telefone, matricula, observacoes, nova_observacao } = req.body;
  const { id } = req.params;
  if (!nome || !telefone || !matricula)
    return res.status(400).json({ erro: 'Campos obrigatórios ausentes.' });

  db.run(
    'UPDATE clientes SET nome=?, telefone=?, matricula=?, observacoes=? WHERE id=?',
    [nome, telefone, matricula.toUpperCase(), observacoes || '', id],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE'))
          return res.status(409).json({ erro: 'Matrícula já cadastrada por outro registro.' });
        return res.status(500).json({ erro: 'Erro ao atualizar.' });
      }
      const obs = (nova_observacao || '').trim();
      const afterUpdate = () => {
        db.get('SELECT * FROM clientes WHERE id = ?', [id], (err, row) => {
          res.json(row);
        });
      };
      if (obs) {
        const dataHora = new Date().toLocaleString('pt-BR');
        db.run(
          'INSERT INTO historico_observacoes (cliente_id, texto, data_hora) VALUES (?,?,?)',
          [id, obs, dataHora],
          afterUpdate
        );
      } else {
        afterUpdate();
      }
    }
  );
});

// Excluir
app.delete('/api/clientes/:id', (req, res) => {
  db.run('DELETE FROM clientes WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ erro: 'Erro ao excluir.' });
    res.json({ ok: true });
  });
});

// Atualizar status (acesso/chegou)
app.patch('/api/clientes/:id/status', (req, res) => {
  const { campo, valor } = req.body;
  if (!['acesso_maquina', 'chegou_maquina'].includes(campo))
    return res.status(400).json({ erro: 'Campo inválido.' });
  db.run(
    `UPDATE clientes SET ${campo} = ? WHERE id = ?`,
    [valor ? 1 : 0, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ erro: 'Erro ao atualizar status.' });
      res.json({ ok: true, campo, valor: valor ? 1 : 0 });
    }
  );
});

// Histórico de observações de um cliente
app.get('/api/clientes/:id/historico', (req, res) => {
  db.all(
    'SELECT * FROM historico_observacoes WHERE cliente_id = ? ORDER BY id DESC',
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar histórico.' });
      res.json(rows);
    }
  );
});

// Adicionar observação ao histórico
app.post('/api/clientes/:id/historico', (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim())
    return res.status(400).json({ erro: 'Texto da observação é obrigatório.' });

  const dataHora = new Date().toLocaleString('pt-BR');
  db.run(
    'INSERT INTO historico_observacoes (cliente_id, texto, data_hora) VALUES (?,?,?)',
    [req.params.id, texto.trim(), dataHora],
    function (err) {
      if (err) return res.status(500).json({ erro: 'Erro ao salvar observação.' });
      // Atualiza o campo observacoes do cliente com a mais recente
      db.run('UPDATE clientes SET observacoes=? WHERE id=?', [texto.trim(), req.params.id]);
      res.status(201).json({ id: this.lastID, cliente_id: Number(req.params.id), texto: texto.trim(), data_hora: dataHora });
    }
  );
});

const server = app.listen(PORT, () => {
  console.log(`\n✅  Servidor rodando em http://localhost:${PORT}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Porta ${PORT} em uso. Finalize o processo atual ou rode com outra porta: PORT=3001 npm start\n`);
    process.exit(1);
  }
  throw err;
});
