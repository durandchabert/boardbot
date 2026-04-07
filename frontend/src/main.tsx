import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.js';
import Setup from './pages/Setup.js';
import Board from './pages/Board.js';
import Recap from './pages/Recap.js';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/session/:id/setup" element={<Setup />} />
        <Route path="/session/:id/board" element={<Board />} />
        <Route path="/session/:id/recap" element={<Recap />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
