import { handleWebhook } from '@caen/commerce/handlers.js';

export const onRequestPost = ({ request, env }) => handleWebhook(request, env);
