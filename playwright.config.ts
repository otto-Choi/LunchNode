import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',workers:1,retries:0,use:{baseURL:'http://localhost:3000',trace:'retain-on-failure',...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})},
 reporter:[['list'],['html',{open:'never'}]],
 webServer:[
  {command:'node tests/rpc-bridge.mjs',url:'http://127.0.0.1:54329/health',reuseExistingServer:false},
  {command:'npm run start -- --port 3000',url:'http://localhost:3000',reuseExistingServer:false,env:{SUPABASE_URL:'http://127.0.0.1:54329',SUPABASE_SERVICE_ROLE_KEY:'ci-only-service-key',AX_INVITE_CODE:'ci-invitation',GLOBAL_INVITE_CODE:'ci-global-invitation',GLOBAL_ADMIN_SECRET:'ci-global-operator-key-at-least-32-characters',CRON_SECRET:'ci-cron',AX_ADMIN_SECRET:'ci-operator-secret-at-least-32-chars',APP_ORIGIN:'http://localhost:3000',DEMO_MODE:'false'}}
 ],
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}]
});
