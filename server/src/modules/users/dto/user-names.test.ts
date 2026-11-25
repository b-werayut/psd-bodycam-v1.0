import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

describe('user names', () => {
  it('validates optional username edits with the same rules as account creation', async () => {
    const dto = plainToInstance(UpdateUserDto, { username: ' New.Name ' });
    expect(await validate(dto, options)).toEqual([]);
    expect(dto).toMatchObject({ username: 'New.Name' });
    for (const username of [null, '', 'ab', 'a'.repeat(51), 'space name', 'ภาษาไทย']) {
      expect(await validate(plainToInstance(UpdateUserDto, { username }), options)).not.toEqual([]);
    }
  });
  it('accepts a trimmed phone and allows clearing it, rejecting values over 30 characters', async () => {
    const dto = plainToInstance(CreateUserDto, {
      username: 'somchai', firstName: 'สมชาย', lastName: 'ใจดี', roleCode: 'VIEWER', phone: ' 0812345678 ',
    });
    expect(await validate(dto, options)).toEqual([]);
    expect(dto).toMatchObject({ phone: '0812345678' });
    expect(await validate(plainToInstance(UpdateUserDto, { phone: null }), options)).toEqual([]);
    expect(await validate(plainToInstance(UpdateUserDto, { phone: 'a'.repeat(31) }), options)).not.toEqual([]);
  });
  it('creates users with separate, trimmed first and last names', async () => {
    const dto = plainToInstance(CreateUserDto, {
      username: 'somchai', firstName: ' สมชาย ', lastName: ' ใจดี ', roleCode: 'VIEWER',
    });
    expect(await validate(dto, options)).toEqual([]);
    expect(dto).toMatchObject({ firstName: 'สมชาย', lastName: 'ใจดี' });
  });

  it('supports a person without a surname and keeps the previous 200-character capacity', async () => {
    const dto = plainToInstance(CreateUserDto, {
      username: 'admin', firstName: 'ก'.repeat(200), lastName: '', roleCode: 'SUPER_ADMIN',
    });
    expect(await validate(dto, options)).toEqual([]);
  });

  it('updates either name independently and allows clearing a surname', async () => {
    for (const body of [{ firstName: ' ใหม่ ' }, { lastName: ' ใหม่ ' }, { lastName: '' }]) {
      expect(await validate(plainToInstance(UpdateUserDto, body), options)).toEqual([]);
    }
  });

  it('rejects null names, blank first names, and names over the column limit', async () => {
    for (const body of [{ firstName: null }, { lastName: null }, { firstName: ' ' }, { lastName: 'a'.repeat(201) }]) {
      expect(await validate(plainToInstance(UpdateUserDto, body), options)).not.toEqual([]);
    }
  });

  it('rejects the removed field on both create and update', async () => {
    const body = { username: 'somchai', fullName: 'สมชาย ใจดี', roleCode: 'VIEWER' };
    expect(await validate(plainToInstance(CreateUserDto, body), options)).not.toEqual([]);
    expect(await validate(plainToInstance(UpdateUserDto, { fullName: body.fullName }), options)).not.toEqual([]);
  });
});
