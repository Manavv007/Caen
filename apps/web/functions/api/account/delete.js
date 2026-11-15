import { handleDeleteAccount } from '@caen/commerce/account.js';

export const onRequestPost = ({ request, env }) => handleDeleteAccount(request, env);
