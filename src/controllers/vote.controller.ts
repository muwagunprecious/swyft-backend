import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/auth.middleware';

// 1. Cast Vote (Public - takes name and email)
export const castVote = async (req: Request, res: Response) => {
  try {
    const { categoryId, contestantId, name, email } = req.body;

    if (!email || !name) {
      return res.status(400).json({ message: 'Name and email are required to cast a vote.' });
    }

    // Find the category
    const { data: category, error: catErr } = await supabase
      .from('VoteCategory')
      .select('eventId')
      .eq('id', categoryId)
      .single();

    if (catErr || !category) {
      return res.status(404).json({ message: 'Voting category not found.' });
    }

    // Find the event
    const { data: event, error: evtErr } = await supabase
      .from('Event')
      .select('isVotingPaid, voteCost, isVotingEnabled')
      .eq('id', category.eventId)
      .single();

    if (evtErr || !event) {
      return res.status(404).json({ message: 'Event not found.' });
    }

    if (event.isVotingEnabled === false) {
      return res.status(400).json({ message: 'Voting is currently closed for this campaign.' });
    }

    // Check if free voting
    if (!event.isVotingPaid) {
      // Free voting: same email cannot vote twice in the same category
      const { data: votes } = await supabase
        .from('Vote')
        .select('id')
        .eq('categoryId', categoryId)
        .eq('email', email);

      if (votes && votes.length > 0) {
        return res.status(400).json({ message: 'You have already voted in this category with this email.' });
      }
    }

    // Cast the vote
    const voteId = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const { data: vote, error: insErr } = await supabase
      .from('Vote')
      .insert({
        id: voteId,
        email,
        name,
        categoryId,
        contestantId,
        isTweaked: false,
        createdAt: new Date().toISOString()
      })
      .select()
      .single();

    if (insErr) throw insErr;

    res.status(201).json({ message: 'Vote cast successfully!', vote });
  } catch (error: any) {
    console.error('Error casting vote:', error);
    res.status(500).json({ message: 'Error casting vote', error: error.message });
  }
};

// 2. Fetch Voting Leaderboard Results (Public/Admin/Organizer)
export const getResults = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;

    const { data: results, error } = await supabase
      .from('VoteCategory')
      .select('*, contestants(*), votes(*)')
      .eq('eventId', eventId);

    if (error) throw error;

    const mappedResults = (results || []).map((category: any) => {
      const categoryVotes = category.votes || [];
      return {
        ...category,
        contestants: (category.contestants || []).map((c: any) => {
          const contestantVotes = categoryVotes.filter((v: any) => v.contestantId === c.id);
          const tweakedVotesCount = contestantVotes.filter((v: any) => v.isTweaked === true).length;
          const realVotesCount = contestantVotes.filter((v: any) => v.isTweaked !== true).length;
          const totalVotesCount = contestantVotes.length;

          return {
            ...c,
            realVotesCount,
            tweakedVotesCount,
            totalVotesCount,
            _count: { votes: totalVotesCount }
          };
        })
      };
    });

    res.status(200).json(mappedResults);
  } catch (error: any) {
    console.error('Error fetching results:', error);
    res.status(500).json({ message: 'Error fetching results', error: error.message });
  }
};

// 3. Tweak Contestant Votes (Organizer & Admin Only)
export const tweakVotes = async (req: AuthRequest, res: Response) => {
  try {
    const { contestantId } = req.params;
    const { categoryId, tweakCount } = req.body;

    if (tweakCount === undefined || isNaN(Number(tweakCount))) {
      return res.status(400).json({ message: 'tweakCount must be a valid number' });
    }

    const count = Number(tweakCount);

    if (count > 0) {
      const newVotes = [];
      for (let i = 0; i < count; i++) {
        newVotes.push({
          id: Math.random().toString(36).substring(2) + Date.now().toString(36),
          email: 'tweak@swyft.com',
          name: 'Organizer Tweak',
          categoryId,
          contestantId,
          isTweaked: true,
          userId: req.user?.userId,
          createdAt: new Date().toISOString()
        });
      }
      const { error } = await supabase.from('Vote').insert(newVotes);
      if (error) throw error;
    } else if (count < 0) {
      const { data: votes } = await supabase
        .from('Vote')
        .select('id')
        .eq('contestantId', contestantId)
        .eq('categoryId', categoryId)
        .eq('isTweaked', true);

      if (votes && votes.length > 0) {
        const toDeleteIds = votes.slice(0, Math.abs(count)).map((v: any) => v.id);
        for (const id of toDeleteIds) {
          await supabase.from('Vote').delete().eq('id', id);
        }
      }
    }

    res.status(200).json({ message: `Successfully adjusted votes by ${count > 0 ? '+' : ''}${count}!` });
  } catch (error: any) {
    console.error('Error tweaking votes:', error);
    res.status(500).json({ message: 'Error tweaking votes', error: error.message });
  }
};
