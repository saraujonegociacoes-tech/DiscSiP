const express = require('express')
const { exec } = require('child_process')
const app = express()

const PORT = 3001

app.use(express.json())

// CORS para permitir chamadas do DiscSiP (HTTPS → localhost)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Private-Network', 'true')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Health check — usado pelo DiscSiP para saber se o helper está rodando
app.get('/ping', (req, res) => {
  res.json({ ok: true })
})

// Aciona uma chamada no MicroSIP via protocolo tel:
app.post('/call', (req, res) => {
  const { number } = req.body
  if (!number) return res.status(400).json({ error: 'number obrigatorio' })

  const clean = String(number).replace(/\D/g, '')
  if (!clean) return res.status(400).json({ error: 'Numero invalido' })

  exec(`start "" "tel:${clean}"`, (err) => {
    if (err) {
      console.error('Erro ao acionar tel:', err.message)
      return res.status(500).json({ error: err.message })
    }
    console.log(`[${new Date().toLocaleTimeString()}] Chamando: ${clean}`)
    res.json({ ok: true, number: clean })
  })
})

app.listen(PORT, '127.0.0.1', () => {
  console.log('=================================')
  console.log(` DiscSiP Helper v1.0`)
  console.log(` http://localhost:${PORT}`)
  console.log('=================================')
  console.log('Aguardando chamadas do DiscSiP...')
  console.log('')
})
