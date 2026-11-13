import { handleCheckout } from '@caen/commerce/handlers.js';

export const onRequestPost = ({ request, env }) => handleCheckout(request, env);
