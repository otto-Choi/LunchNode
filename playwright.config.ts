import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',workers:1,retries:0,use:{baseURL:'http://localhost:3000',trace:'retain-on-failure'},
 reporter:[['list'],['html',{open:'never'}]],
 webServer:[
  {command:'node tests/rpc-bridge.mjs',url:'http://127.0.0.1:54329/health',reuseExistingServer:false},
  {command:'npm run start -- --port 3000',url:'http://localhost:3000',reuseExistingServer:false,env:{SUPABASE_URL:'http://127.0.0.1:54329',SUPABASE_SERVICE_ROLE_KEY:'ci-only-service-key',INVITE_CODE:'ci-invitation',CRON_SECRET:'ci-cron',APP_ORIGIN:'http://localhost:3000',DEMO_MODE:'false'}}
 ],
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}]
});
