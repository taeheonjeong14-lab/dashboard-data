import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Match DDx: allow tunnel dev origins if needed
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok-free.dev', '*.ngrok.io', '*.ngrok.app'],
};

export default nextConfig;
