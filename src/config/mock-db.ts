import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const DB_PATH = path.join(__dirname, 'mock-db-store.json');

// Define the database structure
interface MockDB {
  User: any[];
  Event: any[];
  Ticket: any[];
  Order: any[];
  OrderItem: any[];
  Payment: any[];
  VoteCategory: any[];
  Contestant: any[];
  Vote: any[];
  Payout: any[];
}

export function loadDB(): MockDB {
  if (fs.existsSync(DB_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
      console.error('Error parsing mock-db.json, recreating...', e);
    }
  }
  
  // Seed initial data
  const db: MockDB = {
    User: [
      {
        id: 'admin-user-id',
        email: 'admin@otix.com',
        password: '', // Will hash Admin@OTIX2026 below
        name: 'System Administrator',
        role: 'ADMIN',
        isVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    Event: [
      {
        id: 'tech-summit-oou',
        title: 'OOU Campus Tech Summit 2026',
        description: 'A full-day gathering for builders, designers, founders, and student operators learning how to ship useful products from campus.',
        bannerImage: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1400&q=80',
        date: '2026-07-04T10:00:00.000Z',
        location: 'ICT Centre, Ago-Iwoye',
        organizerId: 'admin-user-id',
        category: 'Tech',
        isVotingEnabled: true,
        isVotingPaid: true,
        voteCost: 50,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'faculty-dinner',
        title: 'Faculty of Arts Dinner and Awards',
        description: 'A polished dinner night with live music, awards, red carpet photos, and faculty alumni guests.',
        bannerImage: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1400&q=80',
        date: '2026-07-12T18:00:00.000Z',
        location: 'Blue Roof Hall, Lagos',
        organizerId: 'admin-user-id',
        category: 'Dinner',
        isVotingEnabled: false,
        isVotingPaid: false,
        voteCost: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'founders-workshop',
        title: 'Student Founders Workshop',
        description: 'A practical workshop on idea validation, pricing, payments, and launching your first campus business.',
        bannerImage: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1400&q=80',
        date: '2026-07-18T11:30:00.000Z',
        location: 'Innovation Hub, Ibadan',
        organizerId: 'admin-user-id',
        category: 'Workshop',
        isVotingEnabled: false,
        isVotingPaid: false,
        voteCost: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'lasu-sports-fest',
        title: 'LASU Inter-Department Sports Festival',
        description: 'Football, basketball, athletics, table tennis, and faculty fan zones across a three-day sports festival.',
        bannerImage: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1400&q=80',
        date: '2026-08-02T08:00:00.000Z',
        location: 'LASU Sports Complex',
        organizerId: 'admin-user-id',
        category: 'Sports',
        isVotingEnabled: false,
        isVotingPaid: false,
        voteCost: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'worship-night',
        title: 'Campus Worship Night',
        description: 'A faith gathering with choirs, spoken word, short teachings, and donation support for outreach projects.',
        bannerImage: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=1400&q=80',
        date: '2026-08-09T17:00:00.000Z',
        location: 'Amphitheatre, OAU',
        organizerId: 'admin-user-id',
        category: 'Religious',
        isVotingEnabled: false,
        isVotingPaid: false,
        voteCost: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'hack-the-campus',
        title: 'Hack The Campus 48-Hour Hackathon',
        description: 'Teams build tools for hostel life, course registration, voting, payments, and student safety.',
        bannerImage: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1400&q=80',
        date: '2026-08-21T09:00:00.000Z',
        location: 'FUTA Computer Lab',
        organizerId: 'admin-user-id',
        category: 'Hackathon',
        isVotingEnabled: false,
        isVotingPaid: false,
        voteCost: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    Ticket: [
      { id: 'tech-summit-oou-student', name: 'Student', price: 2500, quantity: 900, sold: 612, eventId: 'tech-summit-oou' },
      { id: 'tech-summit-oou-vip', name: 'VIP', price: 7500, quantity: 120, sold: 82, eventId: 'tech-summit-oou' },
      { id: 'faculty-dinner-regular', name: 'Regular', price: 8000, quantity: 500, sold: 284, eventId: 'faculty-dinner' },
      { id: 'faculty-dinner-table', name: 'Table', price: 65000, quantity: 30, sold: 18, eventId: 'faculty-dinner' },
      { id: 'founders-workshop-free-pass', name: 'Free Pass', price: 0, quantity: 400, sold: 275, eventId: 'founders-workshop' },
      { id: 'lasu-sports-fest-access-band', name: 'Access Band', price: 1000, quantity: 2000, sold: 912, eventId: 'lasu-sports-fest' },
      { id: 'worship-night-free-seat', name: 'Free Seat', price: 0, quantity: 1500, sold: 960, eventId: 'worship-night' },
      { id: 'hack-the-campus-team-slot', name: 'Team Slot', price: 3000, quantity: 180, sold: 129, eventId: 'hack-the-campus' }
    ],
    Order: [],
    OrderItem: [],
    Payment: [],
    VoteCategory: [
      { id: 'cat-1', name: 'Miss Faculty of Science', eventId: 'tech-summit-oou' }
    ],
    Contestant: [
      { id: 'cont-1', name: 'Teniola Adeyemi', image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=500&q=80', details: JSON.stringify({ department: 'Microbiology' }), categoryId: 'cat-1' },
      { id: 'cont-2', name: 'Ruth Eze', image: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=500&q=80', details: JSON.stringify({ department: 'Computer Science' }), categoryId: 'cat-1' }
    ],
    Vote: [],
    Payout: [
      {
        id: 'payout-1',
        eventId: 'tech-summit-oou',
        eventTitle: 'OOU Campus Tech Summit 2026',
        organizerId: 'admin-user-id',
        organizerName: 'System Administrator',
        amount: 250000,
        status: 'PENDING',
        createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
      },
      {
        id: 'payout-2',
        eventId: 'faculty-dinner',
        eventTitle: 'Faculty of Arts Dinner and Awards',
        organizerId: 'admin-user-id',
        organizerName: 'System Administrator',
        amount: 480000,
        status: 'COMPLETED',
        createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
      },
      {
        id: 'payout-3',
        eventId: 'caa05b3c-c40c-42d1-bbb2-923c0c0d21eb',
        eventTitle: 'orientation',
        organizerId: 'f4ed0afc-ba4c-44ac-9434-93ad38e393a2',
        organizerName: 'Emmanuel Agida',
        amount: 14000,
        status: 'PENDING',
        createdAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString()
      }
    ]
  };

  const salt = bcrypt.genSaltSync(10);
  db.User[0].password = bcrypt.hashSync('Admin@OTIX2026', salt);

  saveDB(db);
  return db;
}

export function saveDB(db: MockDB) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

class MockQueryBuilder {
  tableName: keyof MockDB;
  filters: Array<{ type: string; field: string; value?: any; values?: any[]; pattern?: string }> = [];
  orderByVal: { field: string; ascending: boolean } | null = null;
  limitVal: number | null = null;
  isSingle: boolean = false;
  isCountOnly: boolean = false;
  
  action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  payload: any = null;

  constructor(tableName: keyof MockDB) {
    this.tableName = tableName;
  }

  select(fields?: string, options?: any) {
    if (this.action !== 'insert' && this.action !== 'update') {
      this.action = 'select';
    }
    if (options?.count) {
      this.isCountOnly = true;
    }
    return this;
  }

  eq(field: string, value: any) {
    this.filters.push({ type: 'eq', field, value });
    return this;
  }

  in(field: string, values: any[]) {
    this.filters.push({ type: 'in', field, values });
    return this;
  }

  ilike(field: string, pattern: string) {
    this.filters.push({ type: 'ilike', field, pattern });
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderByVal = { field, ascending: options?.ascending !== false };
    return this;
  }

  limit(num: number) {
    this.limitVal = num;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  insert(payload: any) {
    this.action = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: any) {
    this.action = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  async then(resolve: any, reject: any) {
    try {
      const result = await this.execute();
      resolve(result);
    } catch (err) {
      resolve({ data: null, error: err });
    }
  }

  private async execute() {
    const db = loadDB();
    let table = db[this.tableName];

    if (!table) {
      throw new Error(`Table ${this.tableName} not found in mock DB`);
    }

    if (this.action === 'insert') {
      const records = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted: any[] = [];
      
      for (const rec of records) {
        const newRec = { 
          id: rec.id || Math.random().toString(36).substring(2) + Date.now().toString(36),
          ...rec,
          createdAt: rec.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        table.push(newRec);
        inserted.push(newRec);
      }
      
      saveDB(db);
      
      return {
        data: Array.isArray(this.payload) ? inserted : inserted[0],
        error: null
      };
    }

    if (this.action === 'update') {
      let affectedCount = 0;
      let updatedData: any[] = [];

      table = table.map(row => {
        let matches = true;
        for (const f of this.filters) {
          if (f.type === 'eq' && row[f.field] !== f.value) matches = false;
        }
        if (matches) {
          const updatedRow = { ...row, ...this.payload, updatedAt: new Date().toISOString() };
          affectedCount++;
          updatedData.push(updatedRow);
          return updatedRow;
        }
        return row;
      });

      db[this.tableName] = table;
      saveDB(db);

      return {
        data: this.isSingle ? updatedData[0] : updatedData,
        error: null
      };
    }

    if (this.action === 'delete') {
      let originalLen = table.length;
      table = table.filter(row => {
        let matches = true;
        for (const f of this.filters) {
          if (f.type === 'eq' && row[f.field] !== f.value) matches = false;
        }
        return !matches;
      });

      db[this.tableName] = table;
      saveDB(db);

      return {
        data: null,
        error: null,
        count: originalLen - table.length
      };
    }

    // Default SELECT
    let result = table.filter(row => {
      for (const f of this.filters) {
        if (f.type === 'eq') {
          if (f.field.includes('.')) continue;
          if (row[f.field] !== f.value) return false;
        }
        if (f.type === 'in') {
          if (!f.values?.includes(row[f.field])) return false;
        }
        if (f.type === 'ilike') {
          const val = String(row[f.field] || '').toLowerCase();
          const pat = String(f.pattern || '').replace(/%/g, '').toLowerCase();
          if (!val.includes(pat)) return false;
        }
      }
      return true;
    });

    result = result.map(row => {
      const clone = { ...row };
      
      if (this.tableName === 'Event') {
        clone.Ticket = db.Ticket.filter(t => t.eventId === clone.id);
        clone.VoteCategory = db.VoteCategory.filter(vc => vc.eventId === clone.id).map(vc => {
          const vcClone = { ...vc };
          vcClone.Vote = db.Vote.filter(v => v.categoryId === vc.id);
          return vcClone;
        });
      }
      
      if (this.tableName === 'Ticket') {
        clone.event = db.Event.find(e => e.id === clone.eventId);
      }

      if (this.tableName === 'OrderItem') {
        clone.ticket = db.Ticket.find(t => t.id === clone.ticketId);
        if (clone.ticket) {
          clone.ticket.event = db.Event.find(e => e.id === clone.ticket.eventId);
        }
        clone.order = db.Order.find(o => o.id === clone.orderId);
        if (clone.order) {
          clone.order.user = db.User.find(u => u.id === clone.order.userId);
        }
      }

      if (this.tableName === 'Order') {
        clone.user = db.User.find(u => u.id === clone.userId);
        clone.payment = db.Payment.filter(p => p.orderId === clone.id);
        clone.orderItems = db.OrderItem.filter(oi => oi.orderId === clone.id).map(oi => {
          const oiClone = { ...oi };
          oiClone.ticket = db.Ticket.find(t => t.id === oi.ticketId);
          if (oiClone.ticket) {
            oiClone.ticket.event = db.Event.find(e => e.id === oiClone.ticket.eventId);
          }
          return oiClone;
        });
      }

      if (this.tableName === 'Payment') {
        clone.order = db.Order.find(o => o.id === clone.orderId);
        if (clone.order) {
          clone.order.user = db.User.find(u => u.id === clone.order.userId);
          clone.order.orderItems = db.OrderItem.filter(oi => oi.orderId === clone.order.id).map(oi => {
            const oiClone = { ...oi };
            oiClone.ticket = db.Ticket.find(t => t.id === oi.ticketId);
            if (oiClone.ticket) {
              oiClone.ticket.event = db.Event.find(e => e.id === oiClone.ticket.eventId);
            }
            return oiClone;
          });
        }
      }

      if (this.tableName === 'VoteCategory') {
        clone.contestants = db.Contestant.filter(c => c.categoryId === clone.id);
        clone.votes = db.Vote.filter(v => v.categoryId === clone.id);
      }

      if (this.tableName === 'Contestant') {
        clone.category = db.VoteCategory.find(vc => vc.id === clone.categoryId);
        clone.votes = db.Vote.filter(v => v.contestantId === clone.id);
      }

      if (this.tableName === 'Vote') {
        clone.contestant = db.Contestant.find(c => c.id === clone.contestantId);
        clone.category = db.VoteCategory.find(vc => vc.id === clone.categoryId);
      }

      return clone;
    });

    for (const f of this.filters) {
      if (f.type === 'eq' && f.field.includes('.')) {
        result = result.filter(row => {
          const parts = f.field.split('.');
          let currentVal = row;
          for (const part of parts) {
            if (currentVal && typeof currentVal === 'object') {
              currentVal = currentVal[part];
            } else {
              currentVal = undefined;
            }
          }
          return currentVal === f.value;
        });
      }
    }

    if (this.orderByVal) {
      const { field, ascending } = this.orderByVal;
      result.sort((a, b) => {
        const valA = a[field];
        const valB = b[field];
        if (valA === valB) return 0;
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        if (typeof valA === 'string' && typeof valB === 'string') {
          return ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return ascending ? (valA < valB ? -1 : 1) : (valA < valB ? 1 : -1);
      });
    }

    if (this.limitVal !== null) {
      result = result.slice(0, this.limitVal);
    }

    if (this.isSingle) {
      if (result.length === 0) {
        return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
      }
      return { data: result[0], error: null };
    }

    return {
      data: result,
      error: null,
      count: this.isCountOnly ? result.length : undefined
    };
  }
}

export const mockSupabase = {
  from(tableName: keyof MockDB) {
    return new MockQueryBuilder(tableName);
  }
};
