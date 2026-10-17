import React from 'react';
import App from '../App.jsx';

export function serializeInitialData(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export default function Document({ data }) {
  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Panel Jadwal GLive</title>
        <link rel="icon" href="data:," />
        <link rel="stylesheet" href="/assets/main.css" />
      </head>
      <body>
        <div id="root"><App initialData={data} /></div>
        <script id="initial-data" type="application/json" dangerouslySetInnerHTML={{ __html: serializeInitialData(data) }} />
        <script type="module" src="/assets/main.js" />
        <script src="https://gls.liveplugins.com/embed.js" data-site-id="gls" defer />
      </body>
    </html>
  );
}
