import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity()
export class AccountEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column()
  address!: string;

  @Column()
  chain!: string;

  @Column()
  salt!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
