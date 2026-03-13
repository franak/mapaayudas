(function(){
  'use strict';

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e){
      const href = this.getAttribute('href');
      if(href === '#') return;
      const target = document.querySelector(href);
      if(target){
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Banner animation on scroll (Intersection Observer)
  const banner = document.querySelector('.lp-banner');
  if(banner){
    banner.classList.add('banner-animate');
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          banner.classList.add('in-view');
        } else {
          banner.classList.remove('in-view');
        }
      });
    }, { threshold: 0.15 });

    observer.observe(banner);
  }

  // Animate elements on scroll
  const animateOnScroll = () => {
    const elements = document.querySelectorAll('.benefit, .step');
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if(entry.isIntersecting){
          setTimeout(() => {
            entry.target.classList.add('animate-in');
          }, index * 100);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -50px 0px' });

    elements.forEach(el => observer.observe(el));
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', animateOnScroll);
  } else {
    animateOnScroll();
  }

  // Form handling
  const form = document.getElementById('info-form');
  const statusEl = document.getElementById('form-status');

  function setStatus(text, isSuccess){
    statusEl.textContent = text;
    statusEl.className = 'form-status ' + (isSuccess ? 'success' : 'error');
    
    if(isSuccess){
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'form-status';
      }, 5000);
    }
  }

  if(form){
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando...';
      
      // Check required checkbox
      const aceptoPrivacidad = document.getElementById('acepto-privacidad');
      if (!aceptoPrivacidad || !aceptoPrivacidad.checked) {
        setStatus('Debes aceptar la Política de Privacidad para enviar el formulario.', false);
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
        return;
      }
      
      const suscripcion = document.getElementById('suscripcion');
      
      const data = {
        nombre: document.getElementById('nombre').value.trim(),
        email: document.getElementById('email').value.trim(),
        telefono: document.getElementById('telefono').value.trim(),
        empresa: document.getElementById('empresa').value.trim(),
        interes: document.getElementById('interes').value,
        observaciones: document.getElementById('observaciones').value.trim(),
        source: (suscripcion && suscripcion.checked) ? 'all' : 'coam'
      };

      // Basic validation
      if(!data.nombre || !data.email || !data.telefono || !data.interes){
        setStatus('Por favor, completa todos los campos requeridos.', false);
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
        return;
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if(!emailRegex.test(data.email)){
        setStatus('Por favor, introduce un email válido.', false);
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
        return;
      }

      try{
        const resp = await fetch('/excel/info-request', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(data)
        });

        let result;
        const contentType = resp.headers.get('content-type');
        if(contentType && contentType.includes('application/json')){
          result = await resp.json();
        } else {
          result = { ok: resp.ok };
        }

        if(resp.ok && result.ok !== false){
          setStatus('¡Gracias! Tu solicitud ha sido recibida. Te contactaremos pronto.', true);
          form.reset();
          
          // If user opted in to subscriptions, register them
          if (suscripcion && suscripcion.checked) {
            try {
              await fetch('/excel/subscribe', {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify({
                  nombre: data.nombre,
                  email: data.email,
                  telefono: data.telefono,
                  empresa: data.empresa,
                  source: 'all'
                })
              });
            } catch (subErr) {
              console.log('Subscription optional, continuing...');
            }
          }
        } else {
          const errorMsg = result?.error || 'Hubo un problema al enviar. Intenta más tarde.';
          setStatus(errorMsg, false);
        }
      } catch(err){
        console.error('Form submission error:', err);
        setStatus('Error de conexión. Por favor, revisa tu conexión e intenta de nuevo.', false);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    });

    // Real-time validation feedback
    const inputs = form.querySelectorAll('input[required], select[required]');
    inputs.forEach(input => {
      input.addEventListener('blur', function(){
        if(!this.value.trim()){
          this.style.borderColor = '#e74c3c';
        } else {
          this.style.borderColor = '';
        }
      });
      
      if(input.type === 'email'){
        input.addEventListener('input', function(){
          if(this.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value)){
            this.style.borderColor = '#e74c3c';
          } else {
            this.style.borderColor = '';
          }
        });
      }
    });
  }

  // Lazy loading for images
  if('IntersectionObserver' in window){
    const imgObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          const img = entry.target;
          if(img.dataset.src){
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          imgObserver.unobserve(img);
        }
      });
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
      imgObserver.observe(img);
    });
  }

  // Convocatorias Section - Fetch and display data
  const convSection = document.querySelector('.conv-section');
  if (convSection) {
    const convResults = document.getElementById('conv-results');
    const convTabs = document.querySelectorAll('.conv-tab');
    let currentTab = 'abiertas';
    let convData = [];

    function formatDate(dateStr) {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function renderConvocatorias(filter) {
      if (!convResults) return;
      
      let filtered = [];
      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      if (filter === 'abiertas') {
        filtered = convData.filter(item => 
          item['ESTADO DE LA CONVOCATORIA'] === 'Abierta' || 
          item['ESTADO DE LA CONVOCATORIA'] === 'Abierta (prórroga)' ||
          item['ESTADO DE LA CONVOCATORIA'] === 'Abierta / Prórroga'
        );
      } else if (filter === 'vencen') {
        filtered = convData.filter(item => {
          const hasta = item['PLAZOS > HASTA'];
          if (!hasta) return false;
          const date = new Date(hasta);
          return date >= now && date <= thirtyDaysFromNow;
        });
      }

      if (filtered.length === 0) {
        convResults.innerHTML = '<div class="conv-empty">No hay convocatorias en esta categoría</div>';
        return;
      }

      const items = filtered.slice(0, 6).map(item => {
        const estado = item['ESTADO DE LA CONVOCATORIA'] || '';
        const estadoClass = (filter === 'vencen' || estado.toLowerCase().includes('prórroga')) ? 'closing' : 'open';
        const hasta = item['PLAZOS > HASTA'] || '';
        const organismo = item['ORIGEN > ORGANISMO'] || '';
        const titulo = item['TÍTULO DE LA CONVOCATORIA'] || 'Sin título';
        
        return `
          <div class="conv-item ${filter === 'vencen' ? 'urgent' : ''}">
            <div class="conv-item-header">
              <h3>${titulo}</h3>
              <span class="conv-status ${estadoClass}">${estado || 'Abierta'}</span>
            </div>
            <div class="conv-meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                ${organismo}
              </span>
              ${hasta ? `<span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Vence: ${formatDate(hasta)}
              </span>` : ''}
            </div>
          </div>
        `;
      }).join('');

      convResults.innerHTML = `<div class="conv-list">${items}</div>`;
    }

    async function loadConvocatorias() {
      try {
        const response = await fetch('/excel?source=coam');
        const data = await response.json();
        
        if (data.combinedData && Array.isArray(data.combinedData)) {
          convData = data.combinedData;
          renderConvocatorias(currentTab);
        } else {
          convResults.innerHTML = '<div class="conv-empty">No hay datos disponibles</div>';
        }
      } catch (error) {
        console.error('Error loading conv:', error);
        convResults.innerHTML = '<div class="conv-empty">Error al cargar las convocatorias</div>';
      }
    }

    // Tab switching
    convTabs.forEach(tab => {
      tab.addEventListener('click', function() {
        convTabs.forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentTab = this.dataset.tab;
        renderConvocatorias(currentTab);
      });
    });

    // Load data on page load
    loadConvocatorias();
  }

  // Cookie Banner Logic
  const cookieBanner = document.getElementById('cookie-banner');
  const cookieAccept = document.getElementById('cookie-accept');
  const cookieReject = document.getElementById('cookie-reject');
  
  function checkCookieConsent() {
    if (cookieBanner) {
      const consent = localStorage.getItem('cookieConsent');
      if (!consent) {
        cookieBanner.style.display = 'block';
      }
    }
  }
  
  function setCookieConsent(accepted) {
    localStorage.setItem('cookieConsent', accepted ? 'accepted' : 'rejected');
    if (cookieBanner) {
      cookieBanner.style.display = 'none';
    }
  }
  
  if (cookieAccept) {
    cookieAccept.addEventListener('click', function() {
      setCookieConsent(true);
    });
  }
  
  if (cookieReject) {
    cookieReject.addEventListener('click', function() {
      setCookieConsent(false);
    });
  }
  
  // Initialize cookie banner
  checkCookieConsent();
})();
