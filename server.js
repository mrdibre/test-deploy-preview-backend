require('dotenv').config();

const fastify = require('fastify')({ logger: true });

fastify.register(require('@fastify/cors'), {
  origin: process.env.CORS_ORIGIN || true,
  credentials: true
});

fastify.get('/', async (request, reply) => {
  return { message: 'Hello World!' };
});

fastify.get('/healthz', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    console.log(`Server running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();