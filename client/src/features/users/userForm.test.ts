import { describe, expect, it } from 'vitest';

import {
  emptyUserForm,
  toCreatePayload,
  toUpdatePayload,
  userFormFromEntra,
  validateUserForm,
} from './userForm';

const valid = {
  ...emptyUserForm(),
  username: 'somchai',
  fullName: 'สมชาย ใจดี',
  roleCode: 'OPERATOR',
};

describe('validateUserForm', () => {
  it('accepts a complete form', () => {
    expect(validateUserForm(valid)).toEqual({});
  });

  it('requires a username of at most 50 characters', () => {
    expect(validateUserForm({ ...valid, username: '  ' }).username).toBe(
      'users.form.errorUsernameRequired',
    );
    expect(validateUserForm({ ...valid, username: 'a'.repeat(51) }).username).toBe(
      'users.form.errorUsernameLong',
    );
    expect(validateUserForm({ ...valid, username: 'a'.repeat(50) }).username).toBeUndefined();
  });

  it('requires a full name and a role', () => {
    const errors = validateUserForm({ ...valid, fullName: '', roleCode: '' });
    expect(errors.fullName).toBe('users.form.errorFullNameRequired');
    expect(errors.roleCode).toBe('users.form.errorRoleRequired');
  });

  it('accepts every role with no extra field (single-department system)', () => {
    for (const roleCode of ['ADMIN', 'COMPANY_ADMIN', 'OPERATOR', 'VIEWER', 'TEAM_LEADER']) {
      expect(validateUserForm({ ...valid, roleCode })).toEqual({});
    }
  });

  it('checks email format only when given', () => {
    expect(validateUserForm({ ...valid, email: '' }).email).toBeUndefined();
    expect(validateUserForm({ ...valid, email: 'nope' }).email).toBe('users.form.errorEmail');
    expect(validateUserForm({ ...valid, email: 'a@b.co' }).email).toBeUndefined();
  });
});

describe('toCreatePayload', () => {
  it('trims and lowercases the username and omits an empty password', () => {
    const payload = toCreatePayload({ ...valid, username: '  SomChai ', password: '', email: ' ' });
    expect(payload).toEqual({
      username: 'somchai',
      fullName: 'สมชาย ใจดี',
      roleCode: 'OPERATOR',
    });
  });

  it('keeps a given password and email', () => {
    const payload = toCreatePayload({ ...valid, password: 'secret-pass', email: 'a@b.co' });
    expect(payload.password).toBe('secret-pass');
    expect(payload.email).toBe('a@b.co');
  });

  it('sends azureObjectId only when the form has one', () => {
    expect('azureObjectId' in toCreatePayload(valid)).toBe(false);
    expect(toCreatePayload({ ...valid, azureObjectId: 'oid-1' }).azureObjectId).toBe('oid-1');
  });
});

describe('userFormFromEntra', () => {
  const source = { upn: 'Somchai.J@psd.co.th', displayName: 'สมชาย ใจดี', mail: null, oid: 'oid-1' };

  it('prefills username from the UPN local part, the name, the UPN as email and the oid', () => {
    expect(userFormFromEntra(source)).toEqual({
      ...emptyUserForm(),
      username: 'somchai.j',
      fullName: 'สมชาย ใจดี',
      email: 'Somchai.J@psd.co.th',
      azureObjectId: 'oid-1',
    });
  });

  it('never guesses a role or sets a password', () => {
    const values = userFormFromEntra(source);
    expect(values.roleCode).toBe('');
    expect(values.password).toBe('');
  });

  it('drops characters the server rejects and leaves a too-short username empty', () => {
    expect(userFormFromEntra({ ...source, upn: 'som chai+x@psd.co.th' }).username).toBe('somchaix');
    expect(userFormFromEntra({ ...source, upn: 'ก@psd.co.th' }).username).toBe('');
    expect(userFormFromEntra({ ...source, upn: 'ab@psd.co.th' }).username).toBe('');
  });

  it('falls back to the UPN local part when Entra has no display name', () => {
    expect(userFormFromEntra({ ...source, displayName: null }).fullName).toBe('Somchai.J');
  });

  it('uses mail when the UPN is not an email address', () => {
    const values = userFormFromEntra({ ...source, upn: 'somchai', mail: 'somchai@psd.co.th' });
    expect(values.email).toBe('somchai@psd.co.th');
  });

  it('has no azureObjectId without an oid', () => {
    expect('azureObjectId' in userFormFromEntra({ ...source, oid: undefined })).toBe(false);
  });

  it('produces a form that passes validation once a role is picked', () => {
    expect(validateUserForm({ ...userFormFromEntra(source), roleCode: 'OPERATOR' })).toEqual({});
  });
});

describe('toUpdatePayload', () => {
  it('sends only changed fields and clears optional ones with null', () => {
    const original = { ...valid, email: 'a@b.co' };
    expect(toUpdatePayload({ ...original, fullName: 'ใหม่', email: '' }, original)).toEqual({
      fullName: 'ใหม่',
      email: null,
    });
    expect(toUpdatePayload(original, original)).toEqual({});
    expect(toUpdatePayload({ ...original, password: 'new-password' }, original)).toEqual({
      password: 'new-password',
    });
    expect(toUpdatePayload({ ...original, roleCode: 'VIEWER' }, original)).toEqual({
      roleCode: 'VIEWER',
    });
  });
});
