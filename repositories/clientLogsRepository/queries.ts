const createQuery = () => `INSERT INTO client_logs(text, clientTelegramId) VALUES(:text, :clientTelegramId)`;

export { createQuery };
