import React from 'react';import{act,cleanup,render,screen}from'@testing-library/react';import{afterEach,beforeEach,it,expect,vi}from'vitest';
const m=vi.hoisted(()=>({path:'/privacy',legacy:vi.fn()}));
vi.mock('next/navigation',()=>({usePathname:()=>m.path}));
vi.mock('next/dynamic',()=>({default:()=>({children}:{children:React.ReactNode})=>{m.legacy();return <div data-testid="legacy">{children}</div>;}}));
import{Providers}from'./Providers';
beforeEach(()=>{m.path='/privacy';m.legacy.mockClear();Reflect.deleteProperty(window,'Telegram');});afterEach(()=>{cleanup();document.querySelectorAll('script[data-vox-telegram-sdk]').forEach(script=>script.remove());vi.useRealTimers();Reflect.deleteProperty(window,'Telegram');});
it('public privacy renders immediately without SDK or legacy provider/store initialization',()=>{render(<Providers><div>Guest content</div></Providers>);expect(screen.getByText('Guest content')).toBeInTheDocument();expect(document.head.querySelector('[data-vox-telegram-sdk]')).toBeNull();expect(m.legacy).not.toHaveBeenCalled();});
it.each(['load','error']as const)('Studio children wait for SDK %s then mount with safe fallback',async event=>{m.path='/studio';render(<Providers><div>Studio content</div></Providers>);expect(screen.queryByText('Studio content')).toBeNull();const sdk=document.head.querySelector('[data-vox-telegram-sdk]')!;expect(sdk.getAttribute('src')).toBe('https://telegram.org/js/telegram-web-app.js');await act(async()=>sdk.dispatchEvent(new Event(event)));expect(screen.getByText('Studio content')).toBeInTheDocument();expect(m.legacy).not.toHaveBeenCalled();});
it('legacy app mounts its lazy provider boundary after SDK error',async()=>{m.path='/';render(<Providers><div>Legacy content</div></Providers>);expect(m.legacy).not.toHaveBeenCalled();await act(async()=>document.head.querySelector('[data-vox-telegram-sdk]')!.dispatchEvent(new Event('error')));expect(screen.getByTestId('legacy')).toHaveTextContent('Legacy content');expect(m.legacy).toHaveBeenCalled();});
it('SDK timeout cannot leave Studio indefinitely waiting',async()=>{vi.useFakeTimers();m.path='/studio';render(<Providers><div>Studio content</div></Providers>);await act(async()=>vi.advanceTimersByTime(8000));expect(screen.getByText('Studio content')).toBeInTheDocument();});
it('an already loaded SDK preserves Studio startup without a second script',()=>{m.path='/studio';Object.defineProperty(window,'Telegram',{value:{WebApp:{}},configurable:true});render(<Providers><div>Studio content</div></Providers>);expect(screen.getByText('Studio content')).toBeInTheDocument();expect(document.head.querySelector('[data-vox-telegram-sdk]')).toBeNull();});

it.each(['load','error'] as const)('adopts the pending layout SDK on %s without duplicating or removing it',async event=>{
 m.path='/studio';const sdk=document.createElement('script');sdk.src='https://telegram.org/js/telegram-web-app.js';sdk.dataset.voxTelegramSdk='true';document.head.append(sdk);
 const view=render(<Providers><div>Studio content</div></Providers>);expect(screen.queryByText('Studio content')).toBeNull();expect(document.querySelectorAll('script[data-vox-telegram-sdk]')).toHaveLength(1);
 await act(async()=>sdk.dispatchEvent(new Event(event)));expect(screen.getByText('Studio content')).toBeInTheDocument();view.unmount();expect(sdk.isConnected).toBe(true);
});
it('bounds waiting for an adopted SDK after hydration without removing the layout-owned script',async()=>{
 vi.useFakeTimers();m.path='/studio';const sdk=document.createElement('script');sdk.src='https://telegram.org/js/telegram-web-app.js';sdk.dataset.voxTelegramSdk='true';document.head.append(sdk);
 const view=render(<Providers><div>Studio content</div></Providers>);await act(async()=>vi.advanceTimersByTime(8000));expect(screen.getByText('Studio content')).toBeInTheDocument();expect(document.querySelectorAll('script[data-vox-telegram-sdk]')).toHaveLength(1);view.unmount();expect(sdk.isConnected).toBe(true);
});
it('only adopts the exact official SDK and cleans up its own script',()=>{
 m.path='/studio';const impostor=document.createElement('script');impostor.src='https://example.invalid/telegram-web-app.js';impostor.dataset.voxTelegramSdk='true';document.head.append(impostor);
 const view=render(<Providers><div>Studio content</div></Providers>);const own=Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-vox-telegram-sdk]')).find(script=>script.src==='https://telegram.org/js/telegram-web-app.js')!;expect(own).toBeDefined();expect(screen.queryByText('Studio content')).toBeNull();view.unmount();expect(own.isConnected).toBe(false);expect(impostor.isConnected).toBe(true);
});
