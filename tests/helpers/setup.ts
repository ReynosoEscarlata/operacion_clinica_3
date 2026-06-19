process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://clinic:clinic@localhost:5432/clinic_scheduler_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_dummy';
process.env.RESEND_API_KEY ??= 're_dummy';
process.env.RESEND_FROM_EMAIL ??= 'no-reply@clinica.example.com';
process.env.ADMIN_API_KEY ??= 'test-admin-key';
