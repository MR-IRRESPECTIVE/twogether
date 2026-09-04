import React, { useEffect, useRef } from 'react';

export const Modal = ({ isOpen, onClose, children }) => {
  const modalRef = useRef(null);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end', // bottom sheet on mobile
        justifyContent: 'center',
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(26, 26, 46, 0.4)',
          backdropFilter: 'blur(4px)',
        }}
        onClick={onClose}
      />

      {/* Content */}
      <div
        ref={modalRef}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '500px',
          backgroundColor: 'var(--white)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          padding: '24px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
          // For desktop, we can override in CSS but inline here for simplicity
          '@media (minWidth: 768px)': {
            alignItems: 'center',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 'auto',
            marginTop: 'auto'
          }
        }}
        className="modal-content"
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'transparent',
            border: 'none',
            fontSize: '24px',
            color: 'var(--grey-400)',
            cursor: 'pointer',
            minWidth: 'auto',
            minHeight: 'auto',
            lineHeight: 1
          }}
          aria-label="Close"
        >
          &times;
        </button>
        {children}
      </div>

      <style>{`
        @media (min-width: 768px) {
          .modal-content {
            border-radius: var(--radius-lg) !important;
            margin-bottom: auto !important;
            margin-top: auto !important;
          }
        }
      `}</style>
    </div>
  );
};
