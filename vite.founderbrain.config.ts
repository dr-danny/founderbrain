import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'src/founderbrain-web',plugins:[react()],build:{outDir:'../../dist/founderbrain-web',emptyOutDir:true,sourcemap:false},server:{host:'127.0.0.1',proxy:{'^/api(?:/|$)':{target:'http://127.0.0.1:8080',changeOrigin:false}}}});
