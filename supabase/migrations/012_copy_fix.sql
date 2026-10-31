update movies set why = replace(why, ' без гарантий', '') where why like '% без гарантий%';
