import { handleConfirm } from '@caen/commerce/handlers.js';

export const onRequestPost = ({ request, env }) => handleConfirm(request, env);
