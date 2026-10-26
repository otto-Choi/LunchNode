import type {Page} from '@playwright/test';
export async function navigateMenu(page:Page,name:string){const trigger=page.getByRole('button',{name:'메뉴 열기',exact:true});if(await trigger.isVisible()&&await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();await page.locator('.service-sidebar').getByRole('button',{name,exact:false}).click();}
