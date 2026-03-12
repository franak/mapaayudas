const express = require('express');
const request = require('supertest');
const { expect } = require('chai');

describe('POST /excel/source', () => {
    let app;
    beforeEach(() => {
        // Mount the existing router to a fresh express app for each test
        app = express();
        app.use(express.json());
        const router = require('../src/routes');
        app.use('/excel', router);
    });

    it('returns 400 for invalid body', async () => {
        const res = await request(app).post('/excel/source').send({});
        expect(res.status).to.equal(400);
        expect(res.body).to.have.property('error');
    }).timeout(5000);

    it('disables coam successfully', async () => {
        const res = await request(app).post('/excel/source').send({ source: 'coam', enabled: false });
        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('ok', true);
        expect(res.body).to.have.property('source', 'coam');
        expect(res.body).to.have.property('enabled', false);
    }).timeout(5000);

    it('disables plan-recuperacion successfully', async () => {
        const res = await request(app).post('/excel/source').send({ source: 'plan-recuperacion', enabled: false });
        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('ok', true);
        expect(res.body).to.have.property('source', 'plan-recuperacion');
        expect(res.body).to.have.property('enabled', false);
    }).timeout(5000);
});
