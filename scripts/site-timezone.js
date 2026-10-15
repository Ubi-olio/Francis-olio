// Render dates consistently on computers whose system timezone differs from the blog.
process.env.TZ = hexo.config.timezone || 'Asia/Tokyo';
