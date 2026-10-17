import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import App from './App';
import './App.css';

const initialData = JSON.parse(document.getElementById('initial-data').textContent);

hydrateRoot(document.getElementById('root'),
  <React.StrictMode>
    <App initialData={initialData} />
  </React.StrictMode>
);
