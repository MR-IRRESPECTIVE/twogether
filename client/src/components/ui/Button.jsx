import React from 'react';

export const Button = ({
  children,
  variant = 'primary', // primary, secondary, ghost
  size = 'md', // sm, md, lg
  fullWidth = false,
  isLoading = false,
  disabled = false,
  onClick,
  className = '',
  type = 'button',
  ...props
}) => {
  const baseStyles = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-full)',
    fontWeight: '600',
    transition: 'all 0.2s ease',
    width: fullWidth ? '100%' : 'auto',
    opacity: disabled || isLoading ? 0.6 : 1,
    cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
  };

  const variants = {
    primary: {
      backgroundColor: 'var(--coral)',
      color: 'var(--white)',
      border: 'none',
    },
    secondary: {
      backgroundColor: 'var(--white)',
      color: 'var(--coral)',
      border: '2px solid var(--coral)',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'inherit',
      border: 'none',
    }
  };

  const sizes = {
    sm: { padding: '8px 16px', fontSize: '0.875rem' },
    md: { padding: '12px 24px', fontSize: '1rem' },
    lg: { padding: '16px 32px', fontSize: '1.125rem' },
  };

  const style = {
    ...baseStyles,
    ...variants[variant],
    ...sizes[size],
  };

  return (
    <button
      type={type}
      style={style}
      disabled={disabled || isLoading}
      onClick={onClick}
      className={className}
      {...props}
    >
      {isLoading ? (
        <span style={{ marginRight: '8px' }}>⏳</span> // Placeholder spinner
      ) : null}
      {children}
    </button>
  );
};
