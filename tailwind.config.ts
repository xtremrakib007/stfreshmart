import type {Config} from 'tailwindcss';
export default {content:['./src/**/*.{ts,tsx}'],theme:{extend:{colors:{frost:'#F1F5F3',ink:'#14272B',brine:'#1F5C63',label:'#C8352B',line:'#D5DEDA'},fontFamily:{sans:['var(--font)','system-ui','sans-serif']}}},plugins:[]} satisfies Config;
