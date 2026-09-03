import { createClient } from '@base44/sdk';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

export const getBase44PublicSettings = async () => {
  const appClient = createAxiosClient({
    baseURL: '/api/apps/public',
    headers: { 'X-App-Id': appId },
    token,
    interceptResponses: true,
  });
  const settings = await appClient.get(`/prod/public-settings/by-id/${appId}`);
  return { ...settings, has_session: Boolean(token) };
};
