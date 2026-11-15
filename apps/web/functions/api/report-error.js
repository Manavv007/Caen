import { handleReportError } from '@caen/commerce/client-errors.js';

export const onRequestPost = ({ request, env }) => handleReportError(request, env);
