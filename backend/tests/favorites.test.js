const request = require('supertest');
const express = require('express');
const createApiRouter = require('../routes');
const createFavoritesRouter = require('../routes/favorites');
const path = require('path');

const fs = require('fs');
const usersFile = path.join(__dirname, '../data/test-users.json');
const booksFile = path.join(__dirname, '../data/test-books.json');

// Helper to get a valid JWT
const jwt = require('jsonwebtoken');
const SECRET_KEY = 'test_secret';
function getToken(username = 'sandra') {
  return jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
}

const app = express();
app.use(express.json());
app.use('/api', createApiRouter({
  usersFile,
  booksFile,
  readJSON: (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [],
  writeJSON: (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2)),
  authenticateToken: (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    try {
      req.user = jwt.verify(token, SECRET_KEY);
      next();
    } catch {
      return res.sendStatus(403);
    }
  },
  SECRET_KEY,
}));

describe('Favorites API', () => {
  it('GET /api/favorites should fail without auth', async () => {
    const res = await request(app).get('/api/favorites');
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/favorites should return favorites for valid user', async () => {
    const token = getToken('sandra');
    const res = await request(app)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/favorites should 404 for non-existent user', async () => {
    const token = getToken('nouser');
    const res = await request(app)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/favorites should add a book to favorites', async () => {
    const token = getToken('sandra');
    // Pick a book not already in favorites
    const books = JSON.parse(fs.readFileSync(booksFile, 'utf-8'));
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    const sandra = users.find(u => u.username === 'sandra');
    const notFav = books.find(b => !sandra.favorites.includes(b.id));
    if (!notFav) return; // skip if all are favorites
    const res = await request(app)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookId: notFav.id });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/added/);
  });

  it('POST /api/favorites should not duplicate favorites', async () => {
    const token = getToken('sandra');
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    const sandra = users.find(u => u.username === 'sandra');
    const alreadyFav = sandra.favorites[0];
    const res = await request(app)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookId: alreadyFav });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/added/);
  });

  it('POST /api/favorites should fail with missing bookId', async () => {
    const token = getToken('sandra');
    const res = await request(app)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/favorites should 404 for non-existent user', async () => {
    const token = getToken('nouser');
    const res = await request(app)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookId: '1' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/favorites should fail without auth', async () => {
    const res = await request(app)
      .post('/api/favorites')
      .send({ bookId: '1' });
    expect(res.statusCode).toBe(401);
  });

  describe('DELETE /api/favorites', () => {
    it('should reject missing or invalid authentication without changing data', async () => {
      const before = fs.readFileSync(usersFile, 'utf-8');
      const unauthenticated = await request(app).delete('/api/favorites');
      const invalid = await request(app)
        .delete('/api/favorites')
        .set('Authorization', 'Bearer ' + 'invalid-token');
      expect(unauthenticated.statusCode).toBe(401);
      expect(invalid.statusCode).toBe(403);
      expect(fs.readFileSync(usersFile, 'utf-8')).toBe(before);
    });

    it('should return 404 for an unknown user without changing data', async () => {
      const before = fs.readFileSync(usersFile, 'utf-8');
      const res = await request(app)
        .delete('/api/favorites')
        .set('Authorization', 'Bearer ' + getToken('nouser'));
      expect(res.statusCode).toBe(404);
      expect(fs.readFileSync(usersFile, 'utf-8')).toBe(before);
    });

    it('should persist clearing only the authenticated user and allow repeated clearing', async () => {
      const before = fs.readFileSync(usersFile, 'utf-8');
      const users = JSON.parse(before);
      const sandra = users.find(u => u.username === 'sandra');
      const books = JSON.parse(fs.readFileSync(booksFile, 'utf-8'));
      sandra.favorites = books.slice(0, 2).map(book => book.id);
      fs.writeFileSync(usersFile, JSON.stringify(users));
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await request(app)
            .delete('/api/favorites')
            .set('Authorization', 'Bearer ' + getToken());
          expect(res.statusCode).toBe(200);
          expect(res.body).toEqual({ message: 'All favorites cleared' });
          const persisted = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
          expect(persisted).toEqual(users.map(user =>
            user.username === 'sandra' ? { ...user, favorites: [] } : user
          ));
          const favorites = await request(app)
            .get('/api/favorites')
            .set('Authorization', 'Bearer ' + getToken());
          expect(favorites.body).toEqual([]);
        }
      } finally {
        fs.writeFileSync(usersFile, before);
      }
    });

    it.each(['read', 'write'])('should return a JSON error on a storage %s failure', async (operation) => {
      const failingApp = express();
      const fail = () => { throw new Error('Private storage details'); };
      failingApp.use('/api/favorites', createFavoritesRouter({
        usersFile,
        readJSON: operation === 'read' ? fail : () => [{ username: 'sandra', favorites: ['1'] }],
        writeJSON: fail,
        authenticateToken: (req, res, next) => {
          req.user = { username: 'sandra' };
          next();
        },
      }));
      const res = await request(failingApp).delete('/api/favorites');
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ message: 'Failed to clear favorites' });
    });
  });
});
