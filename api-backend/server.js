const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = 5000;

app.use(express.json()); // Habilita la lectura de JSON en el cuerpo (body) de las peticiones

// CORS: el frontend (localhost:8082) consume la API en otro puerto (localhost:5000)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Registro de cada petición para verla en los logs de Docker Compose
app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

// Conexión a PostgreSQL (los datos vienen de las variables de entorno del docker-compose)
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'tareasdb'
});

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Crea la tabla si no existe y carga las tareas iniciales si está vacía.
// Reintenta porque la base de datos puede tardar unos segundos en aceptar conexiones.
async function iniciarBaseDeDatos() {
  for (let intento = 1; intento <= 30; intento++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tareas (
          id SERIAL PRIMARY KEY,
          texto TEXT NOT NULL
        )
      `);
      const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM tareas');
      if (rows[0].total === 0) {
        await pool.query(
          'INSERT INTO tareas (texto) VALUES ($1), ($2)',
          ['Aprender conceptos básicos de Docker', 'Desplegar mi primer arquitectura de Microservicios']
        );
      }
      console.log('Conectado a PostgreSQL y tabla "tareas" lista');
      return;
    } catch (err) {
      console.log(`Esperando a PostgreSQL (intento ${intento}/30): ${err.message}`);
      await esperar(2000);
    }
  }
  console.error('No fue posible conectar con PostgreSQL');
  process.exit(1);
}

// [GET] Obtener la lista completa de tareas
app.get('/api/tareas', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, texto FROM tareas ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al consultar las tareas' });
  }
});

// [POST] Crear una nueva tarea
app.post('/api/tareas', async (req, res) => {
  const texto = req.body && req.body.texto;
  if (!texto) return res.status(400).json({ mensaje: 'El campo "texto" es obligatorio' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO tareas (texto) VALUES ($1) RETURNING id, texto',
      [texto]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al crear la tarea' });
  }
});

// ===== RETO CALIFICABLE =====
// [DELETE] Vaciar toda la lista de tareas.
// Debe ir ANTES de '/api/tareas/:id'; si no, Express interpretaría "limpiar" como un id.
app.delete('/api/tareas/limpiar', async (req, res) => {
  try {
    await pool.query('DELETE FROM tareas');
    res.json({ mensaje: 'Lista de tareas vaciada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al vaciar las tareas' });
  }
});

// [DELETE] Eliminar una tarea específica mediante su ID en la URL
app.delete('/api/tareas/:id', async (req, res) => {
  const idEliminar = parseInt(req.params.id);
  if (Number.isNaN(idEliminar)) return res.status(400).json({ mensaje: 'ID inválido' });
  try {
    await pool.query('DELETE FROM tareas WHERE id = $1', [idEliminar]);
    res.json({ mensaje: 'Tarea eliminada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al eliminar la tarea' });
  }
});

iniciarBaseDeDatos().then(() => {
  app.listen(PORT, () => console.log(`API REST corriendo en el puerto ${PORT}`));
});
