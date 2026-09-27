import { z } from 'zod';

export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MIN_PASSWORD_LENGTH = 8;

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, 'Username may only contain letters, digits, ".", "_" and "-"');

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(50),
  password: z.string().min(1, 'Password is required').max(200),
});
export type LoginRequest = z.infer<typeof loginSchema>;

export const userCreateSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(USER_ROLES).default('user'),
});
export type UserCreate = z.infer<typeof userCreateSchema>;
export type UserCreateInput = z.input<typeof userCreateSchema>;

export const userUpdateSchema = z
  .object({ role: z.enum(USER_ROLES).optional(), password: passwordSchema.optional() })
  .refine((value) => value.role !== undefined || value.password !== undefined, { message: 'Nothing to update' });
export type UserUpdate = z.infer<typeof userUpdateSchema>;

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(200),
  newPassword: passwordSchema,
});
export type PasswordChange = z.infer<typeof passwordChangeSchema>;

export interface UserDto {
  id: number;
  username: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthStatusDto {
  /** False until the first admin was created from ADMIN_USERNAME / ADMIN_PASSWORD. */
  hasUsers: boolean;
}
