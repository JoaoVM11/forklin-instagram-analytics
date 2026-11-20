import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" permite publicar em qualquer subcaminho (GitHub Pages, Vercel, etc.)
export default defineConfig({ plugins: [react()], base: "./" });
